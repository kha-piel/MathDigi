import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import './auth-shell.css'

type Props = { mode: 'login' | 'register'; title: string; description: string; form: ReactNode; statusMessage?: ReactNode }

export function AuthShell({ mode, title, description, form, statusMessage }: Props) {
  const login = mode === 'login'
  return (
    <main className="sprout-page">
      <div className={`sprout-card ${login ? 'is-login' : 'is-register'}`}>
        <aside className="sprout-art" aria-label="Minh họa UNIGO">
          <svg className="sprout-illustration" viewBox="0 0 390 445" role="img" aria-label="Chậu cây mỉm cười, bình tưới, mặt trời và đám mây">
            <ellipse cx="195" cy="390" rx="118" ry="11" fill="#eac4b2" opacity=".8" />
            <g className="sprout-cloud"><path d="M76 146c0-10 8-18 18-18 3-14 23-18 32-5 13-4 24 5 24 16 9 1 14 6 14 14 0 7-6 12-13 12H86c-7 0-10-4-10-9 0-4 1-7 6-10z" fill="#fff" /></g>
            <g className="sprout-sun"><circle cx="276" cy="116" r="25" fill="#ffd43b" /><g stroke="#f7bf2e" strokeWidth="3" strokeLinecap="round"><path d="M276 76v-10M276 166v-10M236 116h-10M326 116h-10M247 87l-7-7M312 152l-7-7M305 87l7-7M240 152l7-7" /></g></g>
            <path className="sprout-star" d="m85 252 3.5 8 8 3.5-8 3.5-3.5 8-3.5-8-8-3.5 8-3.5z" fill="#ee5a81" />
            <path className="sprout-star" d="m315 265 4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#ee5a81" />
            <g className="sprout-grown"><g className="sprout-leaves"><path d="M185 304c1-45 7-97 16-143" stroke="#2d9e71" strokeWidth="5" fill="none" strokeLinecap="round" /><path d="M185 250c-9-23-24-35-46-41 3 18 18 34 46 41z" fill="#43b580" /><path d="M188 238c11-24 30-37 55-40-8 22-27 35-55 40z" fill="#35ae79" /><path d="M194 206c-4-27 1-46 20-65 4 27-3 49-20 65z" fill="#239c70" /><path d="M178 225c-14-16-31-24-52-22 11 14 28 21 52 22z" fill="#2aa875" /></g><g transform="translate(59 311) rotate(-8)"><path d="M8 14h48l-6 48H17z" fill="#5e81ef" /><path d="M18 14c0-20 29-21 31 0" fill="none" stroke="#5e81ef" strokeWidth="5" /><path d="m55 28 32-24" stroke="#5e81ef" strokeWidth="7" strokeLinecap="round" /><path d="m80 4 18 3" stroke="#5e81ef" strokeWidth="6" strokeLinecap="round" /></g></g>
            <g className="sprout-seedling"><path d="M184 320v-83" stroke="#2d9e71" strokeWidth="6" fill="none" strokeLinecap="round" /><path d="M184 276c-24-4-39-18-42-40 26 0 40 17 42 40z" fill="#43b580" /><path d="M185 263c10-24 27-37 50-38-7 22-25 35-50 38z" fill="#299f71" /><path d="M184 238c-8-16-6-32 2-44 9 15 9 30-2 44z" fill="#65c58e" /></g>
            <g><path d="M139 317h92l-9 65c-.6 6-5.5 10-11.5 10h-51c-6 0-10.5-4-11.5-10z" fill="#ff8260" /><rect x="130" y="302" width="110" height="21" rx="8" fill="#ff6346" /><circle cx="160" cy="348" r="5" fill="#38302c" /><circle cx="209" cy="348" r="5" fill="#38302c" /><circle cx="158" cy="346" r="1.6" fill="white" /><circle cx="207" cy="346" r="1.6" fill="white" /><circle cx="148" cy="363" r="6" fill="#ffb2a1" /><circle cx="221" cy="363" r="6" fill="#ffb2a1" /><path d="M176 362c4 7 12 7 17 0" stroke="#54352e" strokeWidth="2.5" fill="none" strokeLinecap="round" /></g>
          </svg>
          <p className="sprout-badge">{login ? '412 plants watered on time today' : 'A new little sprout is ready for you'}</p>
        </aside>
        <section className="sprout-form-panel">
          <div className="sprout-form-content" key={mode}>
            <div className="sprout-brand"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C4 16 5 8 12 3c7 5 8 13 0 18z" fill="#52b987" /><path d="M12 19V8" stroke="#21855c" strokeWidth="1.6" strokeLinecap="round" /></svg>UNIGO</div>
            <h1 className="sprout-title">{title}</h1>
            <p className="sprout-description">{description}</p>
            {form}
            {statusMessage ? <div className="sprout-status" role="status">{statusMessage}</div> : null}
            <div className="sprout-divider"><span>hoặc</span></div>
            <div className="sprout-socials">
              <button type="button" onClick={() => toast.info('Demo – chưa kết nối')}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.8h5.4a4.7 4.7 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.4z" /><path fill="#34A853" d="M12 22c2.7 0 5-1 6.6-2.6l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4H3.1v2.5A10 10 0 0 0 12 22z" /><path fill="#FBBC05" d="M6.4 13.8A6 6 0 0 1 6.1 12c0-.6.1-1.2.3-1.8V7.7H3.1a10 10 0 0 0 0 8.6z" /><path fill="#EA4335" d="M12 6.2c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-8.9 5.7l3.3 2.5c.8-2.3 3-4 5.6-4z" /></svg>Tiếp tục với Google</button>
              <button type="button" onClick={() => toast.info('Demo – chưa kết nối')}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1877F2" /><path d="M13.7 20v-7h2.3l.4-2.7h-2.7V8.6c0-.8.3-1.4 1.4-1.4h1.5V4.8c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v1.8H8.4V13h2.3v7z" fill="#fff" /></svg>Tiếp tục với Facebook</button>
            </div>
            <p className="sprout-switch-line">{login ? 'First time here?' : 'Already have an account?'} <Link to={login ? '/register' : '/login'}>{login ? 'Plant your account' : 'Log in'}</Link></p>
            <p className="sprout-demo-note">Google và Facebook hiện là giao diện demo.</p>
          </div>
        </section>
      </div>
    </main>
  )
}
