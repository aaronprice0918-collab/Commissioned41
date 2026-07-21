import { notFound } from "next/navigation";
import { DigitalCard } from "@/components/DigitalCard";
import { cardRoleLabel, findEmployeeBySlug } from "@/lib/employeeDirectory";
import { displayPersonName } from "@/lib/data";
import { defaultProfilePhotoForName } from "@/lib/profilePhotos";

const dealershipLogo = "/brand/kennesaw-mazda-premium.jpg";

export default async function PublicEmployeeCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const member = findEmployeeBySlug(slug);
  if (!member) notFound();
  const profilePhoto = defaultProfilePhotoForName(member.name) || dealershipLogo;

  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-b from-[#eef3fb] via-[#e7eefb] to-[#dde8fa] px-5 py-10">
      <DigitalCard
        data={{
          name: member.name,
          displayName: displayPersonName(member.name),
          title: cardRoleLabel(member),
          org: "Kennesaw Mazda",
          phone: member.phone || undefined,
          email: member.email || undefined,
          employeeNumber: member.employeeNumber,
          publicUrl: undefined,
          photoSrc: profilePhoto,
          // The dealership logo is artwork with edge-to-edge lettering — fit the
          // whole mark inside the circle instead of letting the round mask crop it.
          photoContain: profilePhoto === dealershipLogo,
        }}
      />
    </main>
  );
}
