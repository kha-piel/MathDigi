# Chuyển kho câu hỏi Toán bổ sung

Chạy từ `web-app/` bằng Node.js 22.18+ hoặc 24. Chạy sau khi áp dụng schema Phase 2 có `question_bank`, `question_bank_options` và hàm `math_slugify`. Script dùng UUID môn Toán từ `subjects` và khớp chuyên đề theo `topics.subject_id` / `topic_slug`.

1. Chạy dry-run và xem lỗi/mục trùng:

   ```sh
   node scripts/migrate-supplemental-math.mjs
   node --test scripts/migrate-supplemental-math.test.mjs
   ```

2. Backup database và thử trên staging trước. Xuất SQL rồi áp dụng bằng kết nối Postgres có quyền ghi (ví dụ, dùng service đã cấu hình sẵn, không dán mật khẩu vào lệnh):

   ```sh
   node scripts/migrate-supplemental-math.mjs --sql > /tmp/mathdigi-supplemental.sql
   PGSERVICE=mathdigi-staging psql -X -v ON_ERROR_STOP=1 -f /tmp/mathdigi-supplemental.sql
   ```

3. Đối soát với báo cáo dry-run:

   ```sql
   SELECT q.topic, q.review_status, count(DISTINCT q.question_id) AS questions,
          count(o.option_id) AS options,
          count(DISTINCT q.question_id) FILTER (WHERE q.topic_id IS NULL) AS unlinked
   FROM public.question_bank AS q
   LEFT JOIN public.question_bank_options AS o USING (question_id)
   WHERE q.metadata->>'import_batch' = 'supplemental-math-v1'
   GROUP BY q.topic, q.review_status
   ORDER BY q.topic, q.review_status;
   ```

   Baseline: 510 câu (414 câu đã hiển thị → `approved`, 96 câu từ hai bản thô → `pending_review`) và 2.040 lựa chọn, không có câu thiếu chuyên đề. Kiểm tra lại các cặp trùng đề bài nhưng khác phương án trong báo cáo; chúng không bị tự động xóa.

SQL chạy trong một transaction, giữ ID cũ và không ghi đè các bản ghi đã có. Hash chuẩn hóa Unicode NFC/khoảng trắng, không phụ thuộc thứ tự phương án; trùng hash ở nguồn hoặc với một ID khác trong kho sẽ chặn ghi để người quản trị xử lý. Hash không phát hiện công thức tương đương hay bản ghi hiện có chưa có hash.

**Chuyển nguồn đọc là một lần triển khai riêng.** Sau khi đối soát staging và production, chuyển cả nguồn làm bài và tổng quan sang kho DB chỉ lấy câu đã duyệt; kiểm tra bài cũ theo ID trước khi bỏ các import và file TypeScript. Nếu phải quay lại, giữ bản phát hành trước vẫn đọc file gốc; backfill không ghi vào đề trường hoặc lịch sử làm bài. Không xóa hàng đã import khi chưa chạy truy vấn đếm, backup và kiểm tra chúng chưa được sử dụng hoặc chỉnh sửa.
