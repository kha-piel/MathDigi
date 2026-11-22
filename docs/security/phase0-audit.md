# Phase 0 — Kiểm tra bảo mật MathDigi

Phạm vi: file bí mật bị track, `.gitignore`, key cần rotate, xác thực `/api/admin/*` và CORS của `ai_service`.
Không có giá trị bí mật nào được ghi trong tài liệu này.

> Repo `kha-piel/MathDigi` đang **PUBLIC**, nên mọi thứ đã commit đều coi như đã lộ.

## 1. File nhạy cảm đang bị track (`git ls-files | grep -i -E "\.env|\.codex-py|\.idea"`)

| File | Nội dung | Mức độ |
|---|---|---|
| `.env` | `SUPABASE_SERVICE_ROLE_KEY` (JWT role `service_role`), `SUPABASE_DB_PASSWORD`, DB URL/user, anon key | **Nghiêm trọng** — commit `78647d8` |
| `ai_service/.env` | `GEMINI_API_KEY` thật | **Nghiêm trọng** — commit `0637ea6` |
| `ai_service/.env.example` | **cùng `GEMINI_API_KEY` thật** (giống hệt `.env`) | **Nghiêm trọng** |
| `web-app/.env.local` | Supabase URL + anon key (role `anon`, vốn công khai) | Thấp |
| `.env.example`, `web-app/.env.example` | Giá trị giả | OK |
| `.codex-py/**` (~990 file) | Virtualenv Python Windows | Rác, không chứa key |
| `.idea/*` (6 file) | Cấu hình IntelliJ | Rác |

Rác khác đang bị track (không thuộc grep trên, cần anh xác nhận trước khi untrack):
`web-app/node_modules/**` (~6.600 file), `node_modules/**` ở root (~640 file), `web-app/dist/**`,
`ai_service/*.log` (6 file), `ai_service/__pycache__/*.pyc`, `scripts/__pycache__/*.pyc`.
`src/main/resources/auth/auth-app.js` chỉ chứa anon key (an toàn).

## 2. Đã sửa trong PR này

- `git rm --cached .env ai_service/.env web-app/.env.local` (file trên máy vẫn giữ nguyên).
- `.env.example`, `ai_service/.env.example`, `web-app/.env.example`: chỉ còn giá trị giả.
- `.gitignore`: thêm `.env*` (trừ `*.example`), `.codex-py/`, `.idea/`, `__pycache__/`, `*.log`, `web-app/dist/`.

**Lưu ý khi pull:** trên máy khác đang có bản clone, `git pull` nhánh này sẽ **xóa** `.env`, `ai_service/.env`,
`web-app/.env.local` ở local (vì chúng bị xóa khỏi index). Hãy copy backup 3 file đó trước khi pull.

`.codex-py/`, `.idea/`, `node_modules/`, `dist/`, log, pyc vẫn đang bị track; `.gitignore` không có tác dụng
với file đã track. Nếu anh đồng ý, lệnh untrack (không xóa file trên máy):

```bash
git rm -r --cached -q .codex-py .idea node_modules web-app/node_modules web-app/dist \
  ai_service/__pycache__ scripts/__pycache__ ai_service/*.log
```

## 3. Việc anh phải làm thủ công (rotate ngay, kể cả trước khi merge)

1. **Gemini API key** — Google AI Studio / Google Cloud Console → APIs & Services → Credentials:
   tạo key mới, giới hạn key chỉ cho Generative Language API, rồi **xóa** key cũ. Đặt key mới vào `ai_service/.env`.
2. **Mật khẩu DB Supabase** — Dashboard → Project Settings → Database → *Reset database password*.
   Cập nhật `SUPABASE_DB_PASSWORD` / connection string ở mọi nơi dùng (script, `.env` local).
3. **service_role key** — Dashboard → Project Settings → API (API Keys). service_role key cũ dạng JWT
   không thu hồi riêng được: chuyển sang API key mới (`sb_secret_...` / `sb_publishable_...`) rồi tắt legacy JWT keys,
   hoặc *rotate JWT secret* (việc này đổi luôn anon key → phải cập nhật `VITE_SUPABASE_ANON_KEY` và đăng nhập lại).
4. Kiểm tra log sử dụng Gemini và Supabase (Auth/Database logs) xem có truy cập lạ không.

### Xóa key khỏi lịch sử git (tùy chọn, làm **sau** khi đã rotate)

Rotate là bắt buộc; xóa lịch sử chỉ giảm lộ thêm (fork/clone cũ vẫn còn bản cũ).

```bash
pip install git-filter-repo
git clone --mirror https://github.com/kha-piel/MathDigi.git MathDigi-mirror && cd MathDigi-mirror
git filter-repo --invert-paths --path .env --path ai_service/.env --path web-app/.env.local
# ai_service/.env.example phải giữ lại nhưng thay chuỗi key: tạo replacements.txt chứa 1 dòng
#   <GEMINI_KEY_CU>==>REDACTED
git filter-repo --replace-text replacements.txt
git push --force --mirror
```

Sau force-push: mọi người phải clone lại; mở ticket GitHub Support để xóa cache commit/PR cũ nếu cần.

## 4. `ai_service`: xác thực `/api/admin/*` và CORS

### Hiện trạng (`ai_service/main.py`)

- `POST /api/admin/validate-exam`, `POST /api/admin/import-exam-pdf/validate`,
  `POST /api/admin/backfill-school-exam-topics`: **không có bất kỳ xác thực nào**. Ai biết URL cũng gọi được,
  tiêu tốn quota Gemini, upload PDF không giới hạn dung lượng.
- `/api/explain`, `/api/analyze-weaknesses`: cũng không cần đăng nhập.
- Frontend (`admin-import-service.ts`, `exam-ai-service.ts`) không gửi header `Authorization`.
- CORS: `allow_origins=["*"]` + `allow_credentials=True` + mọi method/header. Starlette khi đó phản chiếu
  `Origin` của bất kỳ trang nào → quá rộng. (CORS không phải cơ chế xác thực; dù sửa CORS, curl vẫn gọi được.)

### Đề xuất sửa

1. Dependency FastAPI xác thực Supabase JWT ở mọi endpoint (trừ `/health`):

```python
# ai_service/auth.py
import os, httpx
from fastapi import Depends, Header, HTTPException

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE_ANON_KEY"]

async def current_user(authorization: str = Header(default="")) -> dict:
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Thieu token dang nhap.")
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.get(f"{SUPABASE_URL}/auth/v1/user",
                           headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(401, "Token khong hop le.")
    return {"id": r.json()["id"], "token": token}

async def require_admin(user: dict = Depends(current_user)) -> dict:
    async with httpx.AsyncClient(timeout=10) as http:
        r = await http.get(f"{SUPABASE_URL}/rest/v1/user_profiles",
                           params={"user_id": f"eq.{user['id']}", "select": "role,status"},
                           headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {user['token']}"})
    rows = r.json() if r.status_code == 200 else []
    if not rows or rows[0].get("role") not in ("admin", "teacher") or rows[0].get("status", "active") != "active":
        raise HTTPException(403, "Chi admin/teacher duoc dung chuc nang nay.")
    return user
```

   Gắn `dependencies=[Depends(require_admin)]` cho 3 route `/api/admin/*`, `Depends(current_user)` cho
   `/api/explain`, `/api/analyze-weaknesses`. (Có thể thay gọi `/auth/v1/user` bằng verify JWT cục bộ qua JWKS.)
   Không cần service_role key trong `ai_service`.
2. Frontend gửi `Authorization: Bearer <access_token>` lấy từ `supabase.auth.getSession()` trong
   `admin-import-service.ts` và `exam-ai-service.ts`.
3. CORS lấy từ env:

```python
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])
```

4. Giới hạn upload PDF (ví dụ 20 MB, kiểm tra magic bytes `%PDF`) và rate limit theo user (ví dụ `slowapi`).
   Phần timeout/giới hạn trang thuộc Phase 4.

**Quan trọng:** bước 1 chỉ an toàn khi đã sửa mục 5.2 (người dùng tự đổi `role` thành `admin`).

## 5. Phát hiện thêm (ngoài danh sách, nên sửa cùng đợt)

1. **Path traversal ở `/api/explain`** — `read_knowledge_context()` ghép `obsidian_source_path` vào
   `docs/knowledge-base/` mà không chặn `..`. Gửi `obsidian_source_path="../../ai_service/.env"` sẽ đọc được
   file `.env` (chứa Gemini key) và đưa vào prompt; endpoint lại không cần đăng nhập. Sửa:

```python
file_path = (BASE_VAULT_PATH / normalized).resolve()
if not file_path.is_relative_to(BASE_VAULT_PATH.resolve()) or file_path.suffix.lower() != ".md":
    return ""
```

2. **Tự nâng quyền admin qua `user_profiles`** — policy `user_profiles_owner_update` / `_owner_insert`
   (`web-app/supabase/setup_student_learning_history.sql`) cho user sửa/chèn chính hàng của mình, kể cả cột
   `role`. Một học sinh có thể `update user_profiles set role='admin'` từ trình duyệt bằng anon key →
   `current_user_is_school_exam_admin()` trả `true` → ghi/xóa đề thi. Ngoài ra policy so khớp theo `email`
   (cột do user tự ghi). Sửa bằng migration mới:

```sql
revoke update on public.user_profiles from authenticated;
grant update (username, full_name, school_name, province_city, class_name, phone_number,
              thptqg_exam_year, admission_combo, target_score, target_university, target_major, study_note)
  on public.user_profiles to authenticated;
drop policy if exists "user_profiles_owner_insert" on public.user_profiles;
create policy "user_profiles_owner_insert" on public.user_profiles for insert to authenticated
  with check (user_id = auth.uid() and role = 'student' and coalesce(status, 'active') = 'active');
-- select/update: chỉ dùng user_id = auth.uid(), bỏ nhánh so khớp email.
```

3. **Email `admin@local.test` được hard-code thành admin** trong `current_user_is_school_exam_admin()`
   và `localDevelopmentAdminEmails` (`auth-service.ts`). Nếu Supabase cho đăng ký không cần xác thực email,
   ai đăng ký email này cũng thành admin. Bỏ nhánh này; nhánh so khớp `email` trong hàm cũng nên bỏ.
4. **Storage bucket `school-exams`**: mọi user đã đăng nhập đều được insert/update/delete mọi file
   (`setup_school_exam_storage_bucket.sql`). Đổi `with check`/`using` thành
   `bucket_id = 'school-exams' and public.current_user_is_school_exam_admin()`.
5. Frontend lấy `role` từ `user_metadata` (user tự sửa được qua `supabase.auth.updateUser`) — chỉ ảnh hưởng
   giao diện, nhưng nên đọc `role` từ `user_profiles` (sau khi đã khóa cột ở mục 2).

## 6. Anh cần chốt

1. Untrack `.codex-py/`, `.idea/`, `node_modules/`, `web-app/dist/`, log, pyc (lệnh ở mục 2)?
2. Có xóa key khỏi lịch sử git bằng `git filter-repo` + force-push không?
3. Cho phép cài đặt các đề xuất mục 4 và 5 (auth ai_service, CORS, path traversal, migration RLS/Storage) không?
