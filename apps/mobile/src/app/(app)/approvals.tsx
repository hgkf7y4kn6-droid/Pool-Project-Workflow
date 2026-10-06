import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ApiError } from "@pool/api-client";
import type { Approval } from "@pool/types";
import { Badge, BottomSheet, Button, Card, Chips, EmptyState, ErrorState, LoadingState, Screen, SignaturePad, Text, TextField } from "@/components/ui";
import { useApi } from "@/features/data";
import { api } from "@/lib/api";
import { date, titleCase } from "@/lib/format";
import { useSession, useUser } from "@/providers/session";

type Row = Approval & { requestedFromName: string | null };

/**
 * Approvals inbox. Clients approve/reject with a drawn signature; office staff
 * can record a decision made on paper. Change-order approvals run through the
 * change-order workflow on the server.
 */
export default function Approvals() {
  const user = useUser();
  const { can } = useSession();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const q = useApi<Row[]>(["approvals", projectId, status], "/approvals", { projectId, status });
  const [deciding, setDeciding] = useState<{ approval: Row; decision: "approved" | "rejected" } | null>(null);
  const canDecide = user.role === "client" ? can("approval:decide") : can("change_order:decide_internal");

  return (
    <Screen title="Approvals" back={user.role !== "client"} onRefresh={() => void q.refetch()} refreshing={q.isFetching}>
      <Chips className="mb-4" value={status} onChange={setStatus} options={[{ value: "pending", label: "Waiting" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }]} />
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState offline={q.error instanceof Error && q.error.name === "NetworkError"} onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon="checkmark-done-outline" title={status === "pending" ? "Nothing waiting for a decision" : "Nothing here yet"} />
      ) : (
        <View className="gap-3">
          {q.data.map((a) => (
            <Card key={a.id}>
              <View className="flex-row items-start justify-between gap-2">
                <Text variant="h3" className="flex-1">
                  {a.title}
                </Text>
                <Badge label={titleCase(a.subjectType)} tone="info" size="sm" />
              </View>
              {a.description ? <Text className="mt-1 text-sm">{a.description}</Text> : null}
              <Text variant="caption" className="mt-2">
                {a.status === "pending" ? (a.dueDate ? `Respond by ${date(a.dueDate)}` : "Awaiting decision") : `${titleCase(a.status)} ${date(a.decidedAt)}${a.signatureName ? ` · signed by ${a.signatureName}` : ""}`}
              </Text>
              {a.subjectType === "change_order" && a.subjectId && (
                <Button label="View change order" variant="ghost" size="sm" iconRight="chevron-forward" onPress={() => router.push(`/change-orders/${a.subjectId}`)} />
              )}
              {a.status === "pending" && canDecide && (
                <View className="mt-3 flex-row gap-3">
                  <Button label="Reject" variant="outline" className="flex-1" onPress={() => setDeciding({ approval: a, decision: "rejected" })} />
                  <Button label="Approve" icon="checkmark" className="flex-1" onPress={() => setDeciding({ approval: a, decision: "approved" })} />
                </View>
              )}
            </Card>
          ))}
        </View>
      )}
      {deciding && <DecisionSheet {...deciding} onClose={() => setDeciding(null)} defaultName={user.role === "client" ? user.fullName : ""} />}
    </Screen>
  );
}

function DecisionSheet({ approval, decision, onClose, defaultName }: { approval: Row; decision: "approved" | "rejected"; onClose: () => void; defaultName: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/approvals/${approval.id}/decision`, {
        decision,
        notes: notes || null,
        signatureName: decision === "approved" ? name : null,
        signatureDataUrl: decision === "approved" ? signature : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save the decision. Check your connection."),
  });
  const needsSignature = decision === "approved";
  return (
    <BottomSheet visible onClose={onClose} title={decision === "approved" ? "Approve" : "Reject"}>
      <View className="gap-4">
        <Text variant="bodyStrong">{approval.title}</Text>
        {needsSignature && (
          <>
            <TextField label="Full name" value={name} onChangeText={setName} autoComplete="name" required />
            <SignaturePad onChange={setSignature} />
            <Text variant="caption">By signing you approve this request electronically.</Text>
          </>
        )}
        <TextField label={decision === "rejected" ? "Reason (helps us revise it)" : "Notes (optional)"} value={notes} onChangeText={setNotes} multiline />
        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
        <Button
          label={decision === "approved" ? "Sign and approve" : "Reject"}
          variant={decision === "approved" ? "primary" : "destructive"}
          loading={m.isPending}
          disabled={needsSignature && (!name.trim() || !signature)}
          onPress={() => m.mutate()}
        />
      </View>
    </BottomSheet>
  );
}
