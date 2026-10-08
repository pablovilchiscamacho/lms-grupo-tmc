/** Código legible en grupos de 4: ABCD-EFGH-JKLM-NPQR. */
export const prettyCode = (c: string) => c.match(/.{1,4}/g)?.join("-") ?? c;
