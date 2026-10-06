import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import { CHANGE_ORDER_STATUS_LABELS, type ChangeOrder, type ChangeOrderStatus } from "@pool/types";
import { ChangeOrderBadge } from "@/components/status-badges";
import { BottomSheet, Button, Card, ErrorState, KeyValue, LoadingState, PhotoGrid, Screen, SectionHeader, SignaturePad, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { useSession } from "@/providers/session";

type Detail = ChangeOrder & { availableTransitions: ChangeOrderStatus[]; photos: { id: string; caption: string | null; thumbnailUrl: string | null }[]; decidedByName: string | null };

const ACTION_LABEL: Partial<Record<ChangeOrderStatus, string>> = {
  submitted: "Submit for review",
  client_review: "Send to client",
  approved: "Approve",
  rejected: "Reject",
  scheduled: "Schedule the work",
  completed: "Mark completed",
  draft: "Return to draft",
  void: "Void",
};

/** Change order: Draft → Submitted → Client review → Approved/Rejected → Scheduled → Completed. */
export default function ChangeOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const qc = useQueryClient();
  const q = useApi<Detail>(["change-order", id], `/change-orders/${id}`);
  const [pending, setPending] = useState<ChangeOrderStatus | null>(null);
  const move = useMutation({
    mutationFn: (body: { to: ChangeOrderStatus; notes?: string; signatureName?: string; signatureDataUrl?: string | null }) => api.post(`/change-orders/${id}/transition`, body),
    onSuccess: () => {
      void qc.invalidateQueries();
      setPending(null);
    },
  });
  if (q.isLoading) return <Screen title="Change order" back><LoadingState /></Screen>;
  if (q.error || !q.data) return <Screen title="Change order" back><ErrorState offline onRetry={() => void q.refetch()} /></Screen>;
  const co = q.data;
  const isClient = user?.role === "client";

  return (
    <Screen title={`Change Order #${co.number}`} subtitle={co.title} back onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
      <ChangeOrderBadge status={co.status} />
      <Card className="mt-3 gap-2">
        <Text>{co.description}</Text>
        {co.reason ? <Text variant="caption">Reason: {co.reason}</Text> : null}
      </Card>
      <SectionHeader title="Impact" />
      <Card>
        <KeyValue label="Price" value={money(co.priceCents)} emphasize />
        {!isClient && <KeyValue label="Internal cost" value={money(co.costCents)} />}
        {!isClient && <KeyValue label="Labor" value={`${co.laborHoursImpact}h`} />}
        <KeyValue label="Schedule" value={co.scheduleImpactDays ? `+${co.scheduleImpactDays} working day(s)` : "No change"} />
        {co.materialImpact ? <KeyValue label="Materials" value={co.materialImpact} /> : null}
      </Card>
      {co.decidedAt ? (
        <>
          <SectionHeader title="Decision" />
          <Card>
            <KeyValue label="Decision" value={CHANGE_ORDER_STATUS_LABELS[co.status]} />
            <KeyValue label="By" value={co.signatureName ?? co.decidedByName ?? "—"} />
            <KeyValue label="When" value={dateTime(co.decidedAt)} />
            {co.decisionNotes ? <Text variant="caption">“{co.decisionNotes}”</Text> : null}
          </Card>
        </>
      ) : null}
      {co.photos.length ? (
        <>
          <SectionHeader title="Photos" />
          <PhotoGrid photos={co.photos} />
        </>
      ) : null}
      {!isClient && (
        <Button className="mt-4" label="Add photo" icon="camera" variant="outline" onPress={() => router.push({ pathname: "/camera", params: { projectId: co.projectId, changeOrderId: co.id } })} />
      )}
      {co.availableTransitions.length ? (
        <View className="mt-4 gap-2">
          {co.availableTransitions.map((to) => (
            <Button
              key={to}
              label={ACTION_LABEL[to] ?? CHANGE_ORDER_STATUS_LABELS[to]}
              variant={to === "approved" ? "primary" : to === "void" || to === "rejected" ? "outline" : "secondary"}
              onPress={() => (to === "approved" || to === "rejected" ? setPending(to) : move.mutate({ to }))}
              loading={move.isPending && !pending}
            />
          ))}
        </View>
      ) : null}
      {move.error ? <Text className="mt-2 text-sm text-destructive">{move.error instanceof ApiError ? move.error.message : "Needs a connection"}</Text> : null}
      {pending && <DecideSheet to={pending} defaultName={isClient ? (user?.fullName ?? "") : ""} loading={move.isPending} onClose={() => setPending(null)} onSubmit={(b) => move.mutate({ to: pending, ...b })} />}
    </Screen>
  );
}

function DecideSheet({ to, defaultName, loading, onClose, onSubmit }: { to: ChangeOrderStatus; defaultName: string; loading: boolean; onClose: () => void; onSubmit: (b: { notes?: string; signatureName?: string; signatureDataUrl?: string | null }) => void }) {
  const [name, setName] = useState(defaultName);
  const [sig, setSig] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const approve = to === "approved";
  return (
    <BottomSheet visible onClose={onClose} title={approve ? "Sign to approve" : "Reject change order"}>
      <View className="gap-3">
        {approve && (
          <>
            <TextField label="Full name" value={name} onChangeText={setName} />
            <SignaturePad onChange={setSig} />
          </>
        )}
        <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
        <Button label={approve ? "Approve" : "Reject"} variant={approve ? "primary" : "destructive"} loading={loading} disabled={approve && (!name.trim() || !sig)} onPress={() => onSubmit({ notes: notes || undefined, ...(approve ? { signatureName: name.trim(), signatureDataUrl: sig } : {}) })} />
      </View>
    </BottomSheet>
  );
}
