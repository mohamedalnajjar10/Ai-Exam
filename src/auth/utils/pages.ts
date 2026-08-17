/**
 * Minimal server-rendered HTML pages used by the authentication flows.
 * These let the reset-password link work without any separate frontend
 * application.
 */

const PAGE_STYLES = `
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;width:100%;max-width:400px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
  h1{font-size:20px;margin:0 0 16px}
  p{color:#94a3b8;line-height:1.5;margin:0 0 16px}
  label{display:block;font-size:14px;color:#cbd5e1;margin-bottom:6px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #475569;border-radius:8px;background:#0f172a;color:#e2e8f0;font-size:14px;margin-bottom:16px;outline:none}
  input:focus{border-color:#3b82f6}
  button{width:100%;padding:12px;border:0;border-radius:8px;background:#3b82f6;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#2563eb}
  button:disabled{opacity:.6;cursor:not-allowed}
  .msg{padding:12px;border-radius:8px;font-size:14px;margin-bottom:16px;display:none}
  .msg.error{display:block;background:#450a0a;border:1px solid #7f1d1d;color:#fca5a5}
  .msg.success{display:block;background:#052e16;border:1px solid #14532d;color:#86efac}
  .msg.info{display:block;background:#172554;border:1px solid #1e40af;color:#93c5fd}
`;

/** Password reset form that submits to the reset-password API */
export function resetPasswordPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reset Password - AI Exam</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
<div class="card">
  <h1>Reset your password</h1>
  <div class="msg error" id="error"></div>
  <div class="msg success" id="success"></div>
  <div id="formWrap">
    <form id="resetForm" novalidate>
      <label for="password">New password</label>
      <input type="password" id="password" autocomplete="new-password" required minlength="8"
             placeholder="At least 8 characters, letters and numbers">
      <label for="confirm">Confirm new password</label>
      <input type="password" id="confirm" autocomplete="new-password" required minlength="8"
             placeholder="Repeat the new password">
      <button type="submit" id="submitBtn">Reset password</button>
    </form>
  </div>
  <p id="hint" style="display:none">If this link is expired or invalid, go to the login page and click "Forgot password" to receive a new one.</p>
</div>
<script>
(function () {
  var token = new URLSearchParams(window.location.search).get('token');
  var error = document.getElementById('error');
  var success = document.getElementById('success');
  var hint = document.getElementById('hint');
  var formWrap = document.getElementById('formWrap');

  if (!token) {
    error.textContent = 'Invalid or missing reset link. Please request a new one.';
    formWrap.style.display = 'none';
    hint.style.display = 'block';
    return;
  }

  document.getElementById('resetForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    error.style.display = 'none';
    success.style.display = 'none';

    var password = document.getElementById('password').value;
    var confirm = document.getElementById('confirm').value;

    if (password.length < 8) {
      error.textContent = 'Password must be at least 8 characters long.';
      return;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      error.textContent = 'Password must contain at least one letter and one number.';
      return;
    }
    if (password !== confirm) {
      error.textContent = 'Passwords do not match.';
      return;
    }

    var btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Resetting...';

    try {
      var res = await fetch(window.location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, newPassword: password }),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        error.textContent = data.message || 'Failed to reset the password. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Reset password';
        return;
      }
      formWrap.style.display = 'none';
      success.textContent = data.message || 'Password has been reset successfully. You can now log in.';
      success.style.display = 'block';
    } catch (err) {
      error.textContent = 'Network error. Please check your connection and try again.';
      btn.disabled = false;
      btn.textContent = 'Reset password';
    }
  });
})();
</script>
</body>
</html>`;
}
