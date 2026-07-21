import { canonicalPersonName } from "@/lib/data";

export const defaultProfilePhotosByName: Record<string, string> = {
  "Aaron Price": "/team/aaron-price.jpg",
};

export function defaultProfilePhotoForName(name: string) {
  return defaultProfilePhotosByName[canonicalPersonName(name)] || "";
}

export function defaultProfilePhotoForKey(key: string) {
  const name = key.split(":").slice(1).join(":");
  return defaultProfilePhotoForName(name);
}

export function isDefaultProfilePhoto(photo: string) {
  return Object.values(defaultProfilePhotosByName).includes(photo);
}
