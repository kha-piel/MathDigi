import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
import pymupdf as fitz
from fastapi import HTTPException
from google.genai.errors import ClientError

with patch("dotenv.load_dotenv"), patch.dict("os.environ", {"GEMINI_API_KEY": "test-placeholder"}):
    from ai_service import main

SAMPLE = Path(__file__).resolve().parents[1] / "raw_pdfs" / "de-khao-sat-toan-12-nam-2025-2026-truong-thpt-cau-giay-ha-noi.pdf"
FORM = {
    "subjectCode": "TOAN", "subjectName": "Toán", "schoolName": "Cầu Giấy",
    "city": "Hà Nội", "year": "2026", "variantCode": "101", "durationMinutes": "90",
}


class PdfImportTests(unittest.IsolatedAsyncioTestCase):
    def test_text_layer_does_not_upload_the_original_pdf(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "text.pdf"
            with fitz.open() as document:
                document.new_page().insert_text((60, 60), "Question 1: Find the value of x.")
                document.save(path)
            with patch.object(main.pdf_client.files, "upload") as upload, patch.object(
                main, "generate_import_json", return_value="{}"
            ) as generate:
                self.assertEqual(main.analyze_pdf(path, path.name, "TOAN", "Toán", {}), "{}")
        upload.assert_not_called()
        self.assertIn("--- PAGE 1 ---", generate.call_args.args[0])

    def test_scan_timeout_removes_uploaded_file(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "scan.pdf"
            with fitz.open() as document:
                page = document.new_page()
                image = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 20, 20), False)
                image.clear_with(120)
                page.insert_image(fitz.Rect(0, 0, 20, 20), pixmap=image)
                document.save(path)
            files = main.pdf_client.files
            pending = SimpleNamespace(name="files/scan", state=SimpleNamespace(name="PROCESSING"))
            with patch.object(files, "upload", return_value=pending) as upload, patch.object(
                files, "delete"
            ) as delete, patch.object(main, "PDF_OCR_WAIT_SECONDS", 0):
                with self.assertRaises(HTTPException) as failure:
                    main.analyze_pdf(path, path.name, "TOAN", "Toán", {})
            self.assertEqual(failure.exception.status_code, 504)
            upload.assert_called_once()
            delete.assert_called_once_with(name="files/scan")

    def test_mixed_pdf_ocr_uses_only_scanned_pages_and_keeps_original_page_numbers(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "mixed.pdf"
            with fitz.open() as document:
                document.new_page().insert_text((60, 60), "Question 1: Find x.")
                page = document.new_page()
                image = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 20, 20), False)
                image.clear_with(120)
                page.insert_image(fitz.Rect(0, 0, 20, 20), pixmap=image)
                document.save(path)

            active = SimpleNamespace(name="files/scan", state=SimpleNamespace(name="ACTIVE"))

            def upload_scan(file, config):
                with fitz.open(file) as document:
                    self.assertEqual(document.page_count, 1)
                    self.assertFalse(document[0].get_text().strip())
                    self.assertTrue(document[0].get_images())
                return active

            files = main.pdf_client.files
            with patch.object(files, "upload", side_effect=upload_scan) as upload, patch.object(
                files, "delete"
            ), patch.object(main, "generate_import_json", return_value="{}") as generate:
                main.analyze_pdf(path, path.name, "TOAN", "Toán", {})
            upload.assert_called_once()
            contents = generate.call_args.args[0]
            self.assertIs(contents[0], active)
            self.assertIn("1 -> 2", contents[1])
            self.assertIn("--- PAGE 1 ---\nQuestion 1: Find x.", contents[1])

    def test_retry_backs_off_for_transient_failure(self):
        outcome = Mock(side_effect=[TimeoutError(), TimeoutError(), "ok"])
        with patch.object(main.time, "sleep") as sleep:
            self.assertEqual(main.retry_pdf_request(outcome), "ok")
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_decimal_and_accepted_variants_survive_answer_key_parsing(self):
        self.assertEqual(main.parse_answer_key_text("1.A, 13.DSDS, 17: -0,66 | -0.66, 18: 40"), {
            1: "A", 13: "DSDS", 17: "-0,66 | -0.66", 18: "40",
        })
        self.assertEqual(main.parse_answer_key_text("17: 40 kg"), {17: "40 kg"})

    def test_answer_key_accepts_semicolon_and_space_separated_entries(self):
        for value, expected in (
            ("17: 40; 18: 41", {17: "40", 18: "41"}),
            ("1: A 2: B", {1: "A", 2: "B"}),
            ("17: -0,66 | 0.66 18: 41", {17: "-0,66 | 0.66", 18: "41"}),
            ("17.40, 18.41", {17: "40", 18: "41"}),
        ):
            with self.subTest(value=value):
                self.assertEqual(main.parse_answer_key_text(value), expected)

    def test_decimal_answers_are_not_question_markers(self):
        for answer in ("0.66", "1.5", "1,5", "-2.5"):
            with self.subTest(answer=answer):
                self.assertEqual(main.parse_answer_key_text(f"17: {answer}"), {17: answer})
                self.assertEqual(main.parse_answer_key_text(f"17: {answer} 18: 41"), {17: answer, 18: "41"})

    def test_sample_rejects_page_limit(self):
        with TemporaryDirectory() as directory:
            pdf = Path(directory) / "too-long.pdf"
            with fitz.open() as document:
                for _ in range(31):
                    document.new_page()
                document.save(pdf)
            with self.assertRaises(HTTPException) as failure:
                main.extract_pdf_text(pdf)
            self.assertEqual(failure.exception.status_code, 413)

    async def test_upload_rejects_a_forged_mime_and_enforces_byte_limit(self):
        endpoint = "/api/admin/import-exam-pdf/validate"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver") as api:
            with patch.object(main, "analyze_pdf") as analyze:
                fake = await api.post(endpoint, data=FORM, files={"pdfFile": ("fake.pdf", b"not a PDF", "application/pdf")})
                with patch.object(main, "PDF_MAX_BYTES", 16):
                    too_large = await api.post(endpoint, data=FORM, files={"pdfFile": (SAMPLE.name, SAMPLE.read_bytes(), "application/pdf")})
        self.assertEqual(fake.status_code, 415)
        self.assertEqual(too_large.status_code, 413)
        analyze.assert_not_called()

    async def test_gemini_key_rejection_returns_a_readable_provider_error(self):
        provider_error = ClientError(400, {"error": {
            "message": "Provider error text should not be returned to the browser",
            "details": [{"reason": "API_KEY_INVALID"}],
        }})
        origin = "http://localhost:5173"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver") as api:
            with patch.object(main.pdf_client.files, "upload", side_effect=provider_error) as upload:
                response = await api.post(
                    "/api/admin/import-exam-pdf/validate", data=FORM, headers={"Origin": origin},
                    files={"pdfFile": (SAMPLE.name, SAMPLE.read_bytes(), "application/pdf")},
                )
        upload.assert_called_once()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        self.assertEqual(response.json()["detail"], {
            "code": "AI_PROVIDER_API_KEY_INVALID",
            "message": "Gemini từ chối khóa API. Hãy liên hệ quản trị viên để kiểm tra cấu hình khóa.",
        })

    async def test_sample_scan_keeps_invalid_questions_and_does_not_infer_difficulty(self):
        payload = '{"questions":[{"questionNumber":1,"questionType":"multiple_choice","difficultyLevel":4,"questionText":"Test"},{"questionNumber":2,"questionType":"short_answer","questionText":"Test"}]}'
        ocr_file = SimpleNamespace(name="files/sample", state=SimpleNamespace(name="ACTIVE"))
        files = main.pdf_client.files
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver") as api:
            with patch.object(files, "upload", return_value=ocr_file) as upload, patch.object(files, "delete") as remove, patch.object(
                main, "generate_import_json", return_value=payload
            ):
                response = await api.post("/api/admin/import-exam-pdf/validate", data=FORM, files={
                    "pdfFile": (SAMPLE.name, SAMPLE.read_bytes(), "application/pdf"),
                })
        upload.assert_called_once()
        remove.assert_called_once_with(name=ocr_file.name)
        self.assertEqual(response.status_code, 200)
        questions = response.json()["questions"]
        self.assertEqual([q["difficultyLevel"] for q in questions], [4, None])
        self.assertEqual([q["isValid"] for q in questions], [False, False])
