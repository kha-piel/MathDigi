# Phase 5 — Gia sư Toán

## Kiến trúc

DashboardLayout gắn widget dùng chung; Zustand chỉ giữ ngữ cảnh câu hiện tại.
Trang Exam tự cập nhật câu đang làm; SchoolExam và Review chọn ngữ cảnh khi
người học tương tác với câu. Đóng widget không dừng luồng; nút Dừng hủy fetch.
Đổi tài khoản hủy luồng và đặt lại lịch sử. MarkdownContent hiển thị Markdown/LaTeX.

Gia sư bị ẩn trong bài thi có thời gian trước khi nộp, kể cả khi đồng hồ đã hết
nhưng chưa nộp. ExamPage/SchoolExamPage gọi `setTutorDisabled(reason)` từ trạng thái
bài thi thực (không dựa vào URL); store hủy ngay AbortController của luồng đang chạy
và xóa ngữ cảnh. Sau khi nộp hoặc rời bài thi, widget được bật lại; ngữ cảnh review
có đáp án/lời giải. Đây là rào chắn UX, không phải xác thực server cho kỳ thi.

Frontend lấy access token từ Supabase session, gửi trực tiếp đến AI service qua
`VITE_AI_API_BASE_URL`. Không đưa Gemini key xuống trình duyệt.
Router được tạo bằng `create_tutor_router(client, MODEL_NAME)`; không import main
trong tests. Gemini chạy ở daemon worker thread, gửi queue asyncio có giới hạn.

## Endpoint

`POST /api/tutor/chat`, header `Authorization: Bearer <access token>`.
Body: `messages: [{role: "user"|"assistant", content: string}]`,
`context?: {question_content, options, question_type, topic, student_answer,
correct_answer, solution}`, `reveal_solution?: boolean` (mặc định false).
Tối đa 100 tin đầu vào, mỗi tin 2000 ký tự, tổng 24000; chỉ gửi 12 tin cuối
cho Gemini. Tin cuối phải là user và không được rỗng.

SSE `data: {"type":"delta","text":"..."}\n\n`, rồi `{"type":"done"}`;
lỗi trong luồng: `{"type":"error","message":"..."}` và kết thúc.
Trước luồng: 401 hết phiên, 422 payload sai, 429 kèm Retry-After,
503 khi thiếu cấu hình/xác thực không sẵn sàng. Client timeout 70 giây.

## Cấu hình server

- `GEMINI_API_KEY`: dùng cấu hình hiện tại của main.py.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`: xác thực `/auth/v1/user`.
- `TUTOR_PER_MINUTE`: 10; `TUTOR_PER_DAY`: 100.
- `TUTOR_TIMEOUT_SECONDS`: 60; `TUTOR_IDLE_TIMEOUT_SECONDS`: 20.

Token hợp lệ được cache bằng SHA-256 trong 60 giây, không ghi log token.
Rate limit theo user, sliding window trong bộ nhớ từng process; triển khai nhiều
workers cần shared store như Redis để có giới hạn toàn cục. Một worker Gemini
đang bị chặn ở provider có thể còn chạy đến khi provider trả về sau khi hủy.

## Database

Chạy `web-app/supabase/setup_student_tutor_chat.sql` bằng SQL editor Supabase.
Rollback (xóa dữ liệu): `web-app/supabase/rollback_student_tutor_chat.sql`.
RLS chỉ cho chủ sở hữu select/insert/delete, không update. Không cần attempt_id.
Lịch sử tải 50 tin mới nhất, lưu riêng user/assistant cùng tham chiếu câu hỏi.
Lỗi bảng/quyền/mạng không chặn chat; lỗi lưu có thông báo.

## Bảo mật và giới hạn

Chỉ hỗ trợ Toán; prompt phân biệt ngữ cảnh và chỉ dẫn, không gửi đáp án/lời giải
trong context khi chưa chọn Xem lời giải. Đây là hỗ trợ học tập, không phải cơ chế
chống gian lận: model có thể tự suy ra đáp án hoặc không tuân thủ prompt. Nội dung
được gửi cho Gemini; không nhập thông tin cá nhân nhạy cảm. Không render raw HTML.
CORS của deployment phải cho phép origin ứng dụng và Authorization.

## Kiểm tra thủ công

1. Chạy migration, cấu hình server và frontend; đăng nhập học sinh.
2. Mở nút Gia sư Toán ở desktop/mobile; gửi câu hỏi, kiểm tra LaTeX và stream.
3. Chọn câu ở Exam/SchoolExam/Review; kiểm tra chip, gợi ý và Xem lời giải.
4. Thử Enter/Shift+Enter, 2000 ký tự, Dừng, đóng/mở, đổi tài khoản, xóa lịch sử.
5. Tắt mạng/bật mạng; token hết hạn; vượt rate limit; tạm thiếu bảng lịch sử.
6. Kiểm tra RLS với hai tài khoản, không thể đọc/xóa tin của nhau.
7. Đang stream thì bắt đầu bài thi có thời gian: luồng dừng, nút ẩn. Trước nộp
   không mở được gia sư; sau nộp/review nút xuất hiện cùng ngữ cảnh câu hỏi.

Tests: `cd web-app && npm run lint && npm run build && npm test`;
`cd ai_service && python -m pytest -q`. pytest.ini chỉ thu thập tests/ vì
test_ocr.py ở gốc là script upload PDF thủ công, không phải unit test offline.
