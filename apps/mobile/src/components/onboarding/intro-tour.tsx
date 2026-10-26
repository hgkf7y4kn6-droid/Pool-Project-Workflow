import { useState } from "react";
import { Modal, View } from "react-native";
import type { Role } from "@pool/types";
import { BrandMark } from "@/components/brand";
import { Icon, type IconName } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import { Button, Reveal, Text } from "@/components/ui";
import { kv, KV_KEYS } from "@/lib/kv";

interface Page {
  icon: IconName;
  kicker: string;
  title: string;
  body: string;
  points: string[];
}

const OFFICE: Page[] = [
  {
    icon: "grid-outline",
    kicker: "Your morning in one glance",
    title: "Every job, and what needs you today",
    body: "Home shows today's work across all jobs, what's overdue or blocked, and decisions waiting on you.",
    points: ["Tap any number to drill in", "Pull down to refresh", "The cloud icon shows sync status"],
  },
  {
    icon: "git-network-outline",
    kicker: "Schedules that keep up",
    title: "Slip one stage, see the ripple",
    body: "Stages are linked, so a delay shows its real impact on the finish date before you commit to it.",
    points: ["Weather only warns — it never moves work", "Critical path is highlighted", "Change orders can add schedule time"],
  },
  {
    icon: "create-outline",
    kicker: "Get to yes faster",
    title: "Clients approve from their phone",
    body: "Send change orders and approvals; clients sign on screen and the budget and payment schedule update.",
    points: ["Clients never see your costs", "Signatures are stored with the order", "You're notified the moment they decide"],
  },
];

const FIELD: Page[] = [
  {
    icon: "today-outline",
    kicker: "Built for the job site",
    title: "Today's work comes first",
    body: "Home and Tasks open on what's scheduled for you today, with checklists for every step.",
    points: ["Big buttons that work with gloves", "Required items are marked", "Report a problem in two taps"],
  },
  {
    icon: "cloud-offline-outline",
    kicker: "No signal? No problem",
    title: "Keep working offline",
    body: "Everything you do is saved on this device first and syncs by itself when you're back in range.",
    points: ["“Saved on device” means it's safe", "Nothing is ever silently dropped", "Sync status is always top-right"],
  },
  {
    icon: "camera-outline",
    kicker: "Photos that file themselves",
    title: "Snap it — it's already sorted",
    body: "Photos taken from a task are tagged to the job, stage and task with time and location.",
    points: ["Upload resumes if you lose signal", "Mark photos client-visible when ready", "Before/after pairs for inspections"],
  },
];

const CLIENT: Page[] = [
  {
    icon: "water-outline",
    kicker: "Welcome to your pool build",
    title: "Watch it come to life",
    body: "See where your build is, what's next, and photos from the crew as each stage happens.",
    points: ["Progress and estimated finish", "A timeline from dig to first swim", "Updates as they happen"],
  },
  {
    icon: "create-outline",
    kicker: "Decisions, made simple",
    title: "Approve with a signature",
    body: "When something needs your OK — like an upgrade — review it and sign right on your screen.",
    points: ["Clear prices, no surprises", "Everything you signed is kept", "Reject with a note if it's not right"],
  },
  {
    icon: "chatbubbles-outline",
    kicker: "We're one tap away",
    title: "Message your team",
    body: "Questions about your build? Send a message and your project manager will get back to you.",
    points: ["One thread per project", "Notifications when they reply", "Share photos of your own"],
  },
];

function pagesFor(role: Role): Page[] {
  if (role === "client") return CLIENT;
  if (role === "field_supervisor" || role === "field_worker" || role === "subcontractor") return FIELD;
  return OFFICE;
}

const key = (userId: string) => `${KV_KEYS.introSeen}.${userId}`;

export function hasSeenIntro(userId: string) {
  // E2E web builds disable the tour so tests start on the dashboard.
  return process.env.EXPO_PUBLIC_DISABLE_TOUR === "1" || kv.getString(key(userId)) === "1";
}

export function resetIntro(userId: string) {
  kv.remove(key(userId));
}

/** Three-page, role-aware welcome shown once per user. */
export function IntroTour({ userId, role, onDone }: { userId: string; role: Role; onDone: () => void }) {
  const pages = pagesFor(role);
  const [i, setI] = useState(0);
  const page = pages[i]!;
  const last = i === pages.length - 1;
  const finish = () => {
    kv.set(key(userId), "1");
    onDone();
  };
  return (
    <Modal visible animationType="fade" onRequestClose={finish} statusBarTranslucent>
      <SafeAreaView className="flex-1 bg-hero">
        <View pointerEvents="none" className="absolute -right-28 -top-28 size-96 rounded-full bg-glow/15" />
        <View pointerEvents="none" className="absolute -bottom-40 -left-24 size-96 rounded-full bg-glow/10" />
        <View className="w-full max-w-lg flex-1 self-center px-6 pb-6 pt-4">
          <View className="flex-row items-center justify-between">
            <BrandMark size={36} />
            {!last && <Button label="Skip" variant="dark" size="sm" className="px-3" onPress={finish} />}
          </View>

          <View key={i} className="flex-1 justify-center gap-5">
            <Reveal index={0}>
              <View className="size-16 items-center justify-center rounded-3xl bg-glow">
                <Icon name={page.icon} className="text-3xl text-hero" />
              </View>
            </Reveal>
            <Reveal index={1} className="gap-2">
              <Text className="hero-kicker">
                {page.kicker} · {i + 1} of {pages.length}
              </Text>
              <Text className="font-display text-[34px] leading-[42px] text-hero-foreground" accessibilityRole="header">
                {page.title}
              </Text>
              <Text className="font-sans text-base leading-6 text-hero-muted">{page.body}</Text>
            </Reveal>
            <Reveal index={2} className="gap-3">
              {page.points.map((pt) => (
                <View key={pt} className="flex-row items-center gap-3">
                  <Icon name="checkmark-circle" className="text-xl text-glow" />
                  <Text className="flex-1 font-sans-medium text-[15px] text-hero-foreground">{pt}</Text>
                </View>
              ))}
            </Reveal>
          </View>

          <View className="gap-4">
            <View className="flex-row justify-center gap-2" accessibilityLabel={`Page ${i + 1} of ${pages.length}`}>
              {pages.map((_, d) => (
                <View key={d} className={d === i ? "h-2 w-6 rounded-full bg-glow" : "size-2 rounded-full bg-hero-foreground/25"} />
              ))}
            </View>
            <View className="flex-row gap-3">
              {i > 0 && <Button label="Back" variant="dark" className="flex-1 border border-hero-foreground/20" onPress={() => setI(i - 1)} />}
              <Button label={last ? "Get started" : "Next"} iconRight={last ? "arrow-forward" : undefined} variant="accent" className="flex-1" onPress={() => (last ? finish() : setI(i + 1))} />
            </View>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
