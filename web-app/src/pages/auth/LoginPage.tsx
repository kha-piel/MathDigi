import { useState } from 'react'
import { toast } from 'sonner'
import { AuthShell } from '../../features/auth/components/AuthShell'
import { loginWithIdentity } from '../../features/auth/services/auth-service'
import { useAuthSessionStore } from '../../features/auth/store/auth-session-store'

export function LoginPage() {
  const globalErrorMessage = useAuthSessionStore((state) => state.errorMessage)
  const [identity, setIdentity] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage('')

    if (!identity.trim() || !password.trim()) {
      setErrorMessage('Vui lòng nhập đầy đủ email/username và mật khẩu.')
      return
    }

    setIsSubmitting(true)

    try {
      await loginWithIdentity(identity, password)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Đăng nhập thất bại.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      mode="login"
      title="Hello again, plant pal!"
      description="Your ferns have been asking about you."
      form={
        <form className="legacy-auth-form" onSubmit={handleSubmit}>
          <label className="legacy-auth-form-row">
            <span className="legacy-auth-label">Email hoặc username</span>
            <input
              autoComplete="username"
              name="identity"
              required
              className="legacy-auth-input"
              placeholder="Nhập email hoặc username"
              value={identity}
              onChange={(event) => setIdentity(event.target.value)}
            />
          </label>
          <label className="legacy-auth-form-row">
            <span className="legacy-auth-label">Mật khẩu</span>
            <input
              autoComplete="current-password"
              name="password"
              required
              className="legacy-auth-input"
              placeholder="Nhập mật khẩu"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button className="sprout-eye" type="button" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>◉</button>
          </label>
          <div className="sprout-options"><span>Phiên đăng nhập được lưu trên thiết bị</span><button type="button" onClick={() => toast.info('Chức năng đặt lại mật khẩu chưa được cấu hình')}>Forgot password?</button></div>
          <button className="legacy-auth-submit" disabled={isSubmitting} type="submit">
            {isSubmitting ? <><span className="sprout-spinner" aria-hidden="true" />Đang đăng nhập...</> : "Let's grow →"}
          </button>
        </form>
      }
      statusMessage={
        <>
          {errorMessage ? <p className="legacy-auth-status-text error">{errorMessage}</p> : null}
          {!errorMessage && globalErrorMessage ? (
            <p className="legacy-auth-status-text warning">{globalErrorMessage}</p>
          ) : null}
        </>
      }
    />
  )
}
