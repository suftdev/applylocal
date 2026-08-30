export type WorkPolicy = {
  currentCountry: string;
  authorizedCountries: string[];
  outsideAuthorized: "not_authorized" | "pause";
  sponsorshipOutsideAuthorized: "required" | "not_required" | "pause";
  contractor: "not_applicable" | "pause";
  unknown: "pause" | "not_authorized";
};

export type PolicyQuestion = { question: string; country?: string; employmentType?: "employee" | "contractor" | "unknown" };
export type PolicyDecision = { status: "answer" | "not_applicable" | "pause"; answer?: string; reason: string };

function normalized(value: string): string { return value.trim().toLowerCase(); }

export function resolveWorkAuthorization(policy: WorkPolicy, request: PolicyQuestion): PolicyDecision {
  const question = normalized(request.question);
  const employment = request.employmentType ?? (/(contractor|freelance|independent consultant)/i.test(question) ? "contractor" : "unknown");
  if (employment === "contractor") return policy.contractor === "not_applicable" ? { status: "not_applicable", reason: "Contractor work does not use employee work authorization" } : { status: "pause", reason: "Contractor authorization policy requires user input" };
  const country = request.country?.trim();
  if (!country) return { status: "pause", reason: "The employment country is unknown" };
  const authorized = policy.authorizedCountries.some((item) => normalized(item) === normalized(country));
  if (authorized) return { status: "answer", answer: "Yes", reason: `${country} is in the user's authorized countries` };
  if (policy.outsideAuthorized === "pause") return { status: "pause", reason: `${country} is outside the user's authorized countries` };
  return { status: "answer", answer: "No", reason: `${country} is outside the user's authorized countries` };
}

export function resolveSponsorship(policy: WorkPolicy, request: PolicyQuestion): PolicyDecision {
  const employment = request.employmentType ?? "unknown";
  if (employment === "contractor") return policy.contractor === "not_applicable" ? { status: "not_applicable", reason: "Contractor work does not use employee sponsorship" } : { status: "pause", reason: "Contractor sponsorship policy requires user input" };
  if (!request.country) return { status: "pause", reason: "The sponsorship country is unknown" };
  const authorized = policy.authorizedCountries.some((item) => normalized(item) === normalized(request.country!));
  if (authorized) return { status: "answer", answer: "No", reason: `${request.country} is an authorized work country` };
  if (policy.sponsorshipOutsideAuthorized === "required") return { status: "answer", answer: "Yes", reason: `${request.country} is outside the authorized work countries` };
  if (policy.sponsorshipOutsideAuthorized === "not_required") return { status: "answer", answer: "No", reason: "The saved sponsorship policy does not require sponsorship" };
  return { status: "pause", reason: "Sponsorship policy requires user input for this country" };
}
