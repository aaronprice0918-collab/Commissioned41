import { team, type TeamMember } from "@/lib/data";

export function employeeSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function employeeCardUrl(name: string) {
  return `/card/${employeeSlug(name)}`;
}

export function findEmployeeBySlug(slug: string): TeamMember | undefined {
  return team.find((member) => employeeSlug(member.name) === slug);
}

// Only an email actually ON FILE goes on a customer-facing card. The old
// version FABRICATED addresses from name parts (jdoe@kennesawmazda.com) — a
// customer could email an address that doesn't exist, and it was the wrong
// domain for every other store. No email on file = no email on the card.
export function contactEmailFor(name: string) {
  return team.find((member) => member.name === name)?.email || "";
}

export function cardRoleLabel(member: Pick<TeamMember, "role" | "title">) {
  if (member.role === "F&I") return "F&I Manager";
  if (member.role === "BDC") return "BDC Representative";
  return member.title;
}
