import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Share, View } from "react-native";
import { ApiError } from "@pool/api-client";
import { COMMUNICATION_KIND_LABELS, type CommunicationDraft } from "@pool/types";
import { communicationStatusTone } from "@pool/ui";
import { AiLabel, RecordLinks } from "@/components/intelligence";
import { Badge, Button, Card, ConfirmDialog, ErrorState, LoadingState, Screen, SectionHeader, Text, TextField } from "@/components/ui";
import { useDraft, useIntelMutation } from "@/features/intelligence";
import { api } from "@/lib/api";
import { dateTime, titleCase } from "@/lib/format";
import { useSession } from "@/providers/session";

/** Review a draft: facts used, anything unsupported, edit, then approve or reject. */
export default function DraftReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useSession();
  const draft = useDraft(id);
  const d = draft.data;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (d) {
      setSubject(d.subject);
      setBody(d.body);
    }
  }, [d?.id, d?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read the draft lazily (d?.…): the compiler memoizes these closures on what they reference.
  const version = d?.version ?? 0;
  const changed = !!d && (subject !== d.subject || body !== d.body);
  const save = useIntelMutation(() => api.patch<CommunicationDraft>(`/communications/${id}`, { subject, body, version }));
  const approve = useIntelMutation(async () => {
    const latestVersion = changed ? (await api.patch<CommunicationDraft>(`/communications/${id}`, { subject, body, version })).version : version;
    return api.post<CommunicationDraft>(`/communications/${id}/approve`, { version: latestVersion, post: true });
  });
  const reject = useIntelMutation(() => api.post<CommunicationDraft>(`/communications/${id}/reject`, { reason }));

  if (draft.isLoading) return <Screen title="Draft" back><LoadingState /></Screen>;
  if (!d) return <Screen title="Draft" back><ErrorState message="This draft isn't available." onRetry={() => void draft.refetch()} /></Screen>;
  const editable = d.status === "draft" && can("intelligence:manage");
  const dirty = changed;
  const error = [save.error, approve.error, reject.error].find(Boolean);
  const external = d.audience === "supplier" || d.audience === "subcontractor";

  return (
    <Screen kicker={`${COMMUNICATION_KIND_LABELS[d.kind]} · to ${d.audience}`} title="Review message" back>
      <View className="gap-3">
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge label={titleCase(d.status)} tone={communicationStatusTone[d.status]} />
          {d.source === "agent" ? <AiLabel text="Drafted by AI from verified facts" /> : <Text variant="caption">Drafted from verified facts</Text>}
        </View>

        {d.unsupportedClaims.length && d.status === "draft" ? (
          <Card className="gap-1 border-warning bg-warning-soft">
            <Text variant="bodyStrong">Check before approving</Text>
            {d.unsupportedClaims.map((c) => (
              <Text key={c} className="text-sm text-foreground">
                • {c}
              </Text>
            ))}
          </Card>
        ) : null}

        {editable ? (
          <>
            <TextField label="Subject" value={subject} onChangeText={setSubject} maxLength={200} />
            <TextField label="Message" value={body} onChangeText={setBody} multiline numberOfLines={14} style={{ minHeight: 280 }} />
            {dirty ? <Button label="Save changes" variant="secondary" icon="save-outline" loading={save.isPending} onPress={() => save.mutate(undefined)} /> : null}
          </>
        ) : (
          <Card className="gap-2">
            <Text variant="bodyStrong">{d.subject}</Text>
            <Text selectable>{d.body}</Text>
          </Card>
        )}

        {d.status === "draft" && can("intelligence:approve") ? (
          <View className="gap-2">
            <Button
              label={d.audience === "homeowner" ? "Approve & post to client portal" : "Approve"}
              icon="checkmark-done"
              loading={approve.isPending}
              onPress={() => approve.mutate(undefined)}
              disabled={!subject.trim() || !body.trim()}
            />
            <Button label="Reject" variant="ghost" icon="close" onPress={() => setRejecting(true)} />
            <Text variant="caption">
              {d.audience === "homeowner"
                ? "Approving posts it to the homeowner's message thread in the client portal, as you."
                : "Approving records it; the app doesn't email suppliers or subcontractors. Share it from here after approval."}
            </Text>
          </View>
        ) : null}
        {d.status === "draft" && !can("intelligence:approve") ? <Text variant="caption">A project manager or admin approves messages before they go out.</Text> : null}
        {(d.status === "approved" || d.status === "posted") && (
          <Text variant="caption">
            Approved {dateTime(d.approvedAt)}
            {d.status === "posted" ? " and posted to the client thread." : "."}
          </Text>
        )}
        {d.status === "rejected" ? <Text variant="caption">Rejected: {d.rejectionReason}</Text> : null}
        {external && d.status === "approved" ? (
          <Button label="Share message" variant="outline" icon="share-outline" onPress={() => void Share.share({ title: d.subject, message: `${d.subject}\n\n${d.body}` })} />
        ) : null}
        {error ? <Text className="text-sm text-destructive">{error instanceof ApiError ? error.message : "Needs a connection"}</Text> : null}

        <SectionHeader kicker="Verified" title="Facts this message may use" />
        <Card className="gap-2">
          {d.facts.map((f) => (
            <Text key={`${f.type}:${f.id}:${f.text}`} className="text-sm text-foreground">
              • {f.text}
            </Text>
          ))}
        </Card>
        <RecordLinks items={d.facts.map((f) => ({ type: f.type, id: f.id, label: f.text.slice(0, 60) }))} projectId={d.projectId} title="Source records" />
      </View>

      <ConfirmDialog
        visible={rejecting}
        title="Reject this draft?"
        confirmLabel="Reject"
        destructive
        onCancel={() => setRejecting(false)}
        onConfirm={() => {
          if (reason.trim()) reject.mutate(undefined, { onSettled: () => setRejecting(false) });
        }}
      >
        <TextField label="Why?" value={reason} onChangeText={setReason} multiline maxLength={1000} />
      </ConfirmDialog>
    </Screen>
  );
}
