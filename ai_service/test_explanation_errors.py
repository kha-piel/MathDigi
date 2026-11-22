import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

with patch("dotenv.load_dotenv"), patch.dict("os.environ", {"GEMINI_API_KEY": "fake-key"}), patch("google.genai.Client"):
    import main


class ExplanationTests(unittest.TestCase):
    def request(self):
        body = json.dumps({
            "question_content": "1 + 1?",
            "student_answer": "1",
            "correct_answer": "2",
            "obsidian_source_path": "",
        }).encode()
        messages = []

        async def receive():
            return {"type": "http.request", "body": body}

        async def send(message):
            messages.append(message)

        asyncio.run(main.app({
            "type": "http", "method": "POST", "path": "/api/explain",
            "query_string": b"", "headers": [(b"content-type", b"application/json")],
        }, receive, send))
        return messages[0]["status"], json.loads(messages[1]["body"])

    def test_success(self):
        with patch.object(main.client.models, "generate_content", return_value=SimpleNamespace(text="Hai")):
            self.assertEqual(self.request(), (200, {"status": "success", "explanation": "Hai"}))

    def test_provider_error_is_logged_not_returned(self):
        with patch.object(main.client.models, "generate_content", side_effect=RuntimeError('{"private":"invalid key"}')):
            with self.assertLogs("ai_service.tutor", level="ERROR") as logs:
                status, body = self.request()
        self.assertEqual(status, 502)
        self.assertEqual(body, {"detail": "Gia sư AI đang tạm thời không phản hồi được. Vui lòng thử lại sau."})
        self.assertIn("invalid key", "\n".join(logs.output))

    def test_empty_response(self):
        with patch.object(main.client.models, "generate_content", return_value=SimpleNamespace(text="")):
            with self.assertLogs("ai_service.tutor", level="ERROR"):
                status, body = self.request()
        self.assertEqual(status, 502)
        self.assertNotIn("explanation", body)


if __name__ == "__main__":
    unittest.main()
