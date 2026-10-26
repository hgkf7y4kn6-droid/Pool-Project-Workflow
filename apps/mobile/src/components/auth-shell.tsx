import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { BrandLockup } from "@/components/brand";
import { Icon, type IconName } from "@/components/icon";
import { SafeAreaView } from "@/components/safe-area-view";
import { Reveal, Text } from "@/components/ui";
import { useLayout } from "@/hooks/use-theme";

const FEATURES: { icon: IconName; text: string }[] = [
  { icon: "git-network-outline", text: "Schedules that re-plan themselves when a stage slips" },
  { icon: "cloud-offline-outline", text: "Works on the job site with no signal" },
  { icon: "create-outline", text: "Clients review and sign change orders from their phone" },
];

function BrandPanel({ compact }: { compact: boolean }) {
  return (
    <View className={compact ? "overflow-hidden rounded-b-[36px] bg-hero px-6 pb-8 pt-4" : "flex-1 overflow-hidden rounded-[36px] bg-hero p-10"}>
      {/* Pool-light glow (the marketing site's single-accent-as-light idea). */}
      <View pointerEvents="none" className="absolute -right-24 -top-24 size-72 rounded-full bg-glow/15" />
      <View pointerEvents="none" className="absolute -bottom-32 -left-20 size-80 rounded-full bg-glow/10" />
      <BrandLockup size={compact ? 40 : 48} inverse tagline="Pool construction, managed" />
      <View className={compact ? "mt-6 gap-2" : "mt-auto gap-3"}>
        <Text className="hero-kicker">From first dig to first swim</Text>
        <Text className={compact ? "font-display text-[30px] leading-9 text-hero-foreground" : "font-display text-5xl leading-[56px] text-hero-foreground"}>
          Every build, on schedule and on budget.
        </Text>
      </View>
      <View className={compact ? "mt-5 gap-2.5" : "mt-8 gap-3"}>
        {FEATURES.map((f) => (
          <View key={f.text} className="flex-row items-center gap-3">
            <View className="size-8 items-center justify-center rounded-full bg-hero-foreground/10">
              <Icon name={f.icon} className="text-base text-glow" />
            </View>
            <Text className="flex-1 font-sans-medium text-sm text-hero-foreground/90">{f.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Shared layout for authentication screens. Phones get a deep-water brand
 * header above the form; tablets and desktop split brand panel and form.
 */
export function AuthShell({ title, subtitle, children, showBrand = true }: { title: string; subtitle?: string; children: React.ReactNode; showBrand?: boolean }) {
  const { isTablet } = useLayout();
  const form = (
    <View className="w-full max-w-md gap-6 self-center">
      <Reveal index={1} className="gap-1.5">
        <Text variant="h1">{title}</Text>
        {subtitle ? <Text className="body text-muted-foreground">{subtitle}</Text> : null}
      </Reveal>
      <Reveal index={2} className="gap-6">
        {children}
      </Reveal>
    </View>
  );
  return (
    <SafeAreaView edges={isTablet || !showBrand ? ["top", "bottom"] : ["bottom"]} className="screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        {isTablet ? (
          <View className="flex-1 flex-row gap-6 p-6">
            {showBrand && <BrandPanel compact={false} />}
            <ScrollView keyboardShouldPersistTaps="handled" className="flex-1" contentContainerClassName="flex-grow justify-center p-6">
              {form}
            </ScrollView>
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="flex-grow pb-8">
            {showBrand ? (
              <SafeAreaView edges={["top"]} className="bg-hero">
                <BrandPanel compact />
              </SafeAreaView>
            ) : null}
            <View className={showBrand ? "px-6 pt-7" : "flex-grow justify-center px-6"}>{form}</View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
