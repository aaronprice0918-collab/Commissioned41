import type { Metadata } from "next";
import { LegalPage, LegalH2, LegalP } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — Commissioned 41",
  description: "The terms governing use of Dealer Mission OS, the dealership operating system by Commissioned 41, LLC.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="June 21, 2026"
      intro="These Terms of Service (the “Terms”) govern your access to and use of Dealer Mission OS, the dealership operating system provided by Commissioned 41, LLC (“Commissioned 41,” “we,” “us,” or “our”). By creating an account or using the Service, you agree to these Terms. If you are agreeing on behalf of a dealership or other organization (the “Customer”), you represent that you have authority to bind that organization."
    >
      <LegalH2>1. The Service</LegalH2>
      <LegalP>Dealer Mission OS is a software platform for automotive dealerships that supports lead management, desking, finance and insurance (F&amp;I), reporting, team performance, and related operations, including optional AI-assisted features. We may update, improve, or change the Service over time.</LegalP>

      <LegalH2>2. Accounts and Eligibility</LegalH2>
      <LegalP>You must be at least 18 years old and provide accurate account information. You are responsible for safeguarding your login credentials and for all activity under your account. Notify us promptly of any unauthorized use.</LegalP>

      <LegalH2>3. Customer Data and Ownership</LegalH2>
      <LegalP>As between you and Commissioned 41, the Customer owns all data it submits to the Service (“Customer Data”), including deal, lead, employee, performance, compensation, and customer-contact information. You grant us a limited license to host, process, and use Customer Data solely to provide and improve the Service and as described in our Privacy Policy. You are responsible for ensuring you have the rights and any required consents to submit Customer Data, including any personal information of your employees and customers.</LegalP>

      <LegalH2>4. Acceptable Use</LegalH2>
      <LegalP>You agree not to: (a) use the Service unlawfully or to violate any third party’s rights; (b) upload data you are not authorized to share; (c) attempt to access another organization’s data; (d) reverse engineer, resell, or copy the Service except as permitted; or (e) interfere with the security or operation of the Service.</LegalP>

      <LegalH2>5. AI Features</LegalH2>
      <LegalP>The Service includes AI-assisted features that generate coaching, drafts, summaries, and analysis using third-party AI providers. AI output may be inaccurate or incomplete and is provided for assistance only — it is not professional, legal, financial, accounting, or compliance advice. You are responsible for reviewing and verifying any figures, recommendations, or communications before relying on or acting on them.</LegalP>

      <LegalH2>6. Subscriptions and Fees</LegalH2>
      <LegalP>Access to paid features requires a subscription. Fees, billing cycles, and any trial terms will be presented at sign-up or in an order. Unless stated otherwise, fees are non-refundable, and subscriptions renew automatically until cancelled. We may change pricing prospectively with notice.</LegalP>

      <LegalH2>7. Intellectual Property</LegalH2>
      <LegalP>The Service, including its software, design, and brand (Commissioned 41, Dealer Mission OS, and related marks), is owned by Commissioned 41 and protected by law. These Terms grant you a limited, non-exclusive, non-transferable right to use the Service during your subscription. We may use aggregated, de-identified data that does not identify you, your organization, or any individual to operate and improve the Service.</LegalP>

      <LegalH2>8. Confidentiality</LegalH2>
      <LegalP>Each party will protect the other’s non-public information disclosed in connection with the Service and use it only to perform under these Terms.</LegalP>

      <LegalH2>9. Disclaimers</LegalH2>
      <LegalP>The Service is provided “as is” and “as available.” To the maximum extent permitted by law, we disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that AI output will be accurate.</LegalP>

      <LegalH2>10. Limitation of Liability</LegalH2>
      <LegalP>To the maximum extent permitted by law, Commissioned 41 will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for lost profits, revenue, or data. Our total liability for any claim arising out of or relating to the Service will not exceed the amounts you paid us for the Service in the twelve (12) months before the event giving rise to the claim.</LegalP>

      <LegalH2>11. Indemnification</LegalH2>
      <LegalP>You will defend and indemnify Commissioned 41 against claims arising from your Customer Data, your use of the Service, or your violation of these Terms or applicable law.</LegalP>

      <LegalH2>12. Term and Termination</LegalH2>
      <LegalP>You may stop using the Service at any time. We may suspend or terminate access for non-payment, violation of these Terms, or to protect the Service or other customers. On termination, your right to use the Service ends; we will make Customer Data available for a reasonable period on request, after which it may be deleted.</LegalP>

      <LegalH2>13. Changes to These Terms</LegalH2>
      <LegalP>We may update these Terms from time to time. Material changes will be posted here with an updated date and, where appropriate, communicated to you. Continued use after changes take effect constitutes acceptance.</LegalP>

      <LegalH2>14. Governing Law</LegalH2>
      <LegalP>These Terms are governed by the laws of the State of Georgia, USA, without regard to conflict-of-laws rules. The exclusive venue for disputes will be the state and federal courts located in Georgia.</LegalP>

      <LegalH2>15. Contact</LegalH2>
      <LegalP>Commissioned 41, LLC · Georgia, USA · legal@commissioned41.com</LegalP>
    </LegalPage>
  );
}
