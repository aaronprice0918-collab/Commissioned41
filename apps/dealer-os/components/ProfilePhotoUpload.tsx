"use client";

import { Camera, Trash2, Upload } from "lucide-react";
import { displayPersonName } from "@/lib/data";
import { isDefaultProfilePhoto } from "@/lib/profilePhotos";
import { profilePhotoKey, useProfilePhotos } from "@/components/ProfilePhotoProvider";

export { profilePhotoKey };

const dealershipLogo = "/brand/kennesaw-mazda-premium.jpg";

export function ProfilePhoto({
  photoKey,
  name,
  size = "lg",
}: {
  photoKey: string;
  name: string;
  size?: "md" | "lg" | "xl";
}) {
  const { photoFor } = useProfilePhotos();
  const photo = photoFor(photoKey) || dealershipLogo;
  const isBuiltInPhoto = isDefaultProfilePhoto(photo);
  const isDealershipLogo = photo === dealershipLogo;
  const displayName = displayPersonName(name);
  const sizeClass = size === "xl" ? "h-40 w-40" : size === "lg" ? "h-36 w-36" : "h-24 w-24";

  return (
    <div className={`${sizeClass} overflow-hidden rounded-full border border-mission-gold/40 bg-mission-deep shadow-gold ${isBuiltInPhoto || isDealershipLogo ? "p-1.5" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo}
        alt={isDealershipLogo ? "Kennesaw Mazda logo" : displayName}
        className={`h-full w-full rounded-full object-center ${isBuiltInPhoto || isDealershipLogo ? "object-contain" : "object-cover"}`}
      />
    </div>
  );
}

export function ProfilePhotoUploader({ photoKey, name }: { photoKey: string; name: string }) {
  const { photoFor, removePhoto, savePhoto } = useProfilePhotos();
  const hasPhoto = Boolean(photoFor(photoKey));

  function upload(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") savePhoto(photoKey, reader.result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="rounded-[12px] border border-white/10 bg-white/[0.035] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
        <Camera className="h-4 w-4 text-mission-gold" />
        Profile Photo
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-mission-gold px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-navy shadow-gold transition hover:brightness-110">
          <Upload className="h-4 w-4" />
          Upload
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={`Upload photo for ${displayPersonName(name)}`}
            onChange={(event) => upload(event.target.files?.[0])}
          />
        </label>
        {hasPhoto && (
          <button
            type="button"
            onClick={() => removePhoto(photoKey)}
            className="inline-flex items-center gap-2 rounded-full border border-mission-red/35 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-mission-red transition hover:bg-mission-red/10"
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
