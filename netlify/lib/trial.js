/* The first three weeks are the whole product. The clock is the earlier of the household
   document's own birthday and the server row's, so a phone can shorten its trial by editing
   the document but never lengthen it, floored at the day billing began (BILLING_SINCE) so a
   household older than billing gets its three weeks too. The app computes the same from the
   same two dates. */
export const TRIAL_DAYS = 21;
export const stampOrNull = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; };
export function trialStart(h) {
  let born = stampOrNull(h.doc_created); const row = stampOrNull(h.created_at);
  if (row && (!born || row < born)) born = row;
  const since = stampOrNull(process.env.BILLING_SINCE);
  if (!born) return since;
  return since && since > born ? since : born;
}
export function trialEnd(h) {
  const start = trialStart(h);
  return start ? new Date(start.getTime() + TRIAL_DAYS * 86400000) : null;
}
export function trialing(h, now = Date.now()) {
  const end = trialEnd(h);
  return !!end && end.getTime() > now;
}
