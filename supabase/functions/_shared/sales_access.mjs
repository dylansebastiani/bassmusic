// Per-show revenue (face_cents and counts per price) is for the company's owner only.
// Same rule as canManage() in company.ts (the account function stays self-contained and spells it inline).
export const canSeeSalesInPromoter = (canManageCompany) => !!canManageCompany;
