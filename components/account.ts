/**
 * The signed-in chip in the top bar — the single server-rendered piece of the
 * legacy markup (it used to be `<?php echo $elUser ?>` plus a CSRF field).
 */

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string,
  );

/** Portal top bar: avatar + username + Sign out button. */
export function portalAccount(user: string): string {
  return `<div class="account">
    <span class="account-user" title="Signed in as">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
      ${escapeHtml(user)}
    </span>
    <form class="logout-form" method="post" action="/api/auth/logout">
      <button type="submit" class="signout" title="End this session">Sign out</button>
    </form>
  </div>`;
}

/** Test harness header row: plain text + link back to the portal + Sign out. */
export function testAccount(user: string): string {
  return `<div class="account">
      <span>Signed in as <b>${escapeHtml(user)}</b></span>
      <a href="/">Open portal →</a>
      <form class="logout-form" method="post" action="/api/auth/logout">
        <button type="submit" class="linklike">Sign out</button>
      </form>
    </div>`;
}
