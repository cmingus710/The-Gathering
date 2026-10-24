import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";

/** Any one of these opens Admin → Youth & families (each page checks its own). */
export const YOUTH_ADMIN_CAPS: Capability[] = [
  CAPABILITIES.youthManage,
  CAPABILITIES.youthPublish,
  CAPABILITIES.youthEnroll,
  CAPABILITIES.youthForms,
  CAPABILITIES.youthLogistics,
  CAPABILITIES.youthMediaConsent,
  CAPABILITIES.youthSafeguarding,
  CAPABILITIES.youthPolicy,
  CAPABILITIES.familyVerify,
  CAPABILITIES.youthActivities,
];
