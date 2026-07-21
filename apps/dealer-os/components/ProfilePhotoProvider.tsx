"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { defaultProfilePhotoForKey } from "@/lib/profilePhotos";
import { loadStore, saveStore } from "@/lib/storeClient";

type ProfilePhotoContextValue = {
  photos: Record<string, string>;
  photoFor: (key: string) => string;
  savePhoto: (key: string, dataUrl: string) => void;
  removePhoto: (key: string) => void;
};

const ProfilePhotoContext = createContext<ProfilePhotoContextValue | null>(null);

export function ProfilePhotoProvider({ children }: { children: React.ReactNode }) {
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const readyToSave = useRef(false);

  useEffect(() => {
    loadStore<Record<string, string>>("photos").then((saved) => {
      if (saved && typeof saved === "object" && !Array.isArray(saved)) setPhotos(saved);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!readyToSave.current) {
      readyToSave.current = true;
      return;
    }
    void saveStore("photos", photos);
  }, [loaded, photos]);

  const value = useMemo(
    () => ({
      photos,
      photoFor: (key: string) => photos[key] || defaultProfilePhotoForKey(key),
      savePhoto: (key: string, dataUrl: string) => setPhotos((current) => ({ ...current, [key]: dataUrl })),
      removePhoto: (key: string) =>
        setPhotos((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        }),
    }),
    [photos]
  );

  return <ProfilePhotoContext.Provider value={value}>{children}</ProfilePhotoContext.Provider>;
}

export function useProfilePhotos() {
  const context = useContext(ProfilePhotoContext);
  if (!context) {
    throw new Error("useProfilePhotos must be used inside ProfilePhotoProvider");
  }
  return context;
}

export function profilePhotoKey(role: string, name: string) {
  return `${role}:${name}`;
}
