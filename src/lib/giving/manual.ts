import { z } from "zod";

const optionalUuid = z.union([z.uuid(), z.literal("")]).transform((v) => v || null);

/**
 * Cash/check entry and correction form. Inputs the form leaves out (the
 * donor name box is hidden once a member is linked; the check number is
 * hidden for cash) default to empty instead of failing validation.
 */
export const manualInput = z.object({
  formToken: z.uuid(),
  donorProfileId: optionalUuid.default(""),
  donorName: z.string().trim().max(200).default(""),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date received."),
  amount: z.string(),
  fundId: z.uuid({ message: "Choose a fund." }),
  method: z.enum(["cash", "check"], { message: "Choose cash or check." }),
  checkReference: z.string().trim().max(60).default(""),
  note: z.string().trim().max(500).default(""),
});
