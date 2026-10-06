import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { PHOTO_KINDS, type PhotoKind } from "@pool/types";
import { Chips, EmptyState, Fab, PhotoGrid, Screen } from "@/components/ui";
import { usePhotos, useProject } from "@/features/data";
import { useLayout } from "@/hooks/use-theme";
import { titleCase } from "@/lib/format";
import { useSession } from "@/providers/session";

export default function ProjectPhotos() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const { isTablet } = useLayout();
  const project = useProject(id);
  const photos = usePhotos({ projectId: id });
  const [kind, setKind] = useState<PhotoKind | "all">("all");
  const rows = useMemo(() => (photos.data ?? []).filter((p) => kind === "all" || p.kind === kind), [photos.data, kind]);
  return (
    <>
      <Screen title="Photos" subtitle={project.data?.name} back>
        <Chips className="mb-3" value={kind} onChange={setKind} options={[{ value: "all", label: "All" }, ...PHOTO_KINDS.map((k) => ({ value: k, label: titleCase(k) }))]} />
        {rows.length ? <PhotoGrid photos={rows} columns={isTablet ? 5 : 3} /> : <EmptyState icon="images-outline" title="No photos yet" />}
      </Screen>
      {can("photo:create") && <Fab icon="camera" label="Take photo" onPress={() => router.push({ pathname: "/camera", params: { projectId: id } })} />}
    </>
  );
}
