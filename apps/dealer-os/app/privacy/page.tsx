import type { Metadata } from "next";
import { LegalPage, LegalH2, LegalP, LegalLI } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Commissioned 41",
  description: "How Commissioned 41, LLC collects, uses, and protects information in Dealer Mission OS.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="July 6, 2026"
      intro="This Privacy Policy explains how Commissioned 41, LLC (“Commissioned 41,” “we,” “us”) handles information in connection with Dealer Mission OS, our dealership operating system. We take the trust dealerships place in us seriously — especially with employee compensation data and customer information."
    >
      <LegalH2>1. Our Role</LegalH2>
      <LegalP>For data a dealership submits to run its operations (deals, leads, employee and performance data, and customer contact and deal information), the dealership is the controller of that data and Commissioned 41 acts as its processor — we handle that data to provide the Service on the dealership’s behalf. For account, billing, and marketing information, Commissioned 41 is the controller.</LegalP>

      <LegalH2>2. Information We Collect</LegalH2>
      <ul className="list-disc space-y-1.5 pl-5">
        <LegalLI><strong className="text-white/85">Account information</strong> — name, email, role, and login credentials.</LegalLI>
        <LegalLI><strong className="text-white/85">Dealership operational data</strong> — deals, leads, inventory, goals, and team data, including employee names, performance metrics, and compensation figures entered into the Service.</LegalLI>
        <LegalLI><strong className="text-white/85">Customer information</strong> entered by the dealership — such as names, contact details, vehicle and trade information, and deal/finance details used to complete transactions.</LegalLI>
        <LegalLI><strong className="text-white/85">Usage and device data</strong> — log data, device and browser information, and how the Service is used, to keep it secure and reliable.</LegalLI>
      </ul>

      <LegalH2>3. How We Use Information</LegalH2>
      <LegalP>We use information to provide, secure, maintain, and improve the Service; to authenticate users and enforce permissions; to generate reports and AI-assisted features; to provide support; to process payments; and to comply with legal obligations. We do not sell personal information.</LegalP>

      <LegalH2>4. AI Processing</LegalH2>
      <LegalP>When you use the in-app assistant, relevant data (for example, the deal, pipeline, or team figures needed to answer your request) is sent to our third-party AI provider, Anthropic, to generate a response. This data is processed to serve your request and is not used by us or, per our provider’s API terms, by the provider to train its models. Document and photo scanning features (for example, deal recaps, driver’s licenses, or insurance cards) work the same way: the image is read to extract the fields you asked for and is not stored by us — only the extracted fields you save are retained. Do not enter information you are not authorized to process through AI features.</LegalP>

      <LegalH2>5. How We Share Information</LegalH2>
      <LegalP>We share information with service providers (subprocessors) that help us operate the Service under confidentiality and data-protection obligations: hosting and delivery (Vercel), database and authentication (Supabase), AI processing (Anthropic), payment processing (Stripe), voice synthesis for the assistant (ElevenLabs), text-message delivery (Twilio), and email delivery (Resend). We may also disclose information to comply with law, enforce our Terms, protect rights and safety, or in connection with a merger or acquisition. We do not sell your data.</LegalP>

      <LegalH2>6. Data Retention</LegalH2>
      <LegalP>We retain Customer Data for as long as the account is active or as needed to provide the Service, and afterward as required for legal, accounting, or legitimate business purposes. A dealership may request export or deletion of its Customer Data as described below.</LegalP>

      <LegalH2>7. Security</LegalH2>
      <LegalP>We use technical and organizational measures to protect information, including encryption in transit and at rest, access controls, tenant isolation between dealerships, and role-based permissions. Because dealership deal records can include consumer financial information covered by the Gramm-Leach-Bliley Act, we maintain a written information security program consistent with the FTC Safeguards Rule expectations for service providers, and will support our dealership customers’ own Safeguards obligations. No system is perfectly secure, but we work to safeguard data and to limit access to those who need it to operate the Service.</LegalP>

      <LegalH2>8. Your Rights and Choices</LegalH2>
      <LegalP>Depending on your location, you or your dealership may have rights to access, correct, export, or delete personal information. Because dealerships control the data they submit, individuals (such as employees or customers) should direct requests to their dealership, which we will support as processor. You may contact us using the details below.</LegalP>

      <LegalH2>9. Children</LegalH2>
      <LegalP>The Service is intended for businesses and is not directed to children under 18. We do not knowingly collect personal information from children.</LegalP>

      <LegalH2>10. Changes to This Policy</LegalH2>
      <LegalP>We may update this Policy from time to time. Material changes will be posted here with an updated date and, where appropriate, communicated to you.</LegalP>

      <LegalH2>11. Contact</LegalH2>
      <LegalP>Commissioned 41, LLC · Georgia, USA · privacy@commissioned41.com</LegalP>
    </LegalPage>
  );
}
