/**
 * Erreurs des Edge Functions (supabase.functions.invoke) : statut HTTP et
 * champ `error` du corps JSON. `error.context` est la Response (FunctionsHttpError).
 */
type InvokeError = { context?: { status?: number; json?: () => Promise<unknown> } } | null | undefined;

export async function functionError(error: InvokeError): Promise<{ status?: number; code?: string }> {
  const ctx = error?.context;
  let code: string | undefined;
  try {
    const body = typeof ctx?.json === 'function' ? await ctx.json() : undefined;
    const e = (body as { error?: unknown } | undefined)?.error;
    if (typeof e === 'string') code = e;
  } catch {
    // corps absent ou non JSON
  }
  return { status: ctx?.status, code };
}

/** send-parent-consent → clé i18n. */
export async function consentSendErrorKey(error: InvokeError): Promise<string> {
  const { status, code } = await functionError(error);
  switch (status) {
    case 400:
      return code === 'parent_email must differ from own email' ? 'pending.ownEmail' : 'pending.missingAddress';
    case 409:
      return code === 'parent_email_locked' ? 'pending.locked' : 'pending.notEligible';
    case 429:
      return 'pending.tooMany';
    case 502:
      return 'pending.deliveryFailed';
    default:
      return 'errors.generic';
  }
}

/** delete-account → clé i18n. */
export async function deleteAccountErrorKey(error: InvokeError): Promise<string> {
  const { status } = await functionError(error);
  return status === 409 ? 'errors.lastAdminDelete' : 'errors.generic';
}
