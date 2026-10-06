import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "@/components/safe-area-view";
import { Icon } from "@/components/icon";
import { Text } from "@/components/ui";

/** Shared layout for authentication screens. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <SafeAreaView className="screen">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="flex-grow justify-center p-6">
          <View className="w-full max-w-md gap-6 self-center">
            <View className="items-center gap-3">
              <View className="size-16 items-center justify-center rounded-2xl bg-primary">
                <Icon name="water" className="text-4xl text-primary-foreground" />
              </View>
              <Text variant="display" className="text-center">
                {title}
              </Text>
              {subtitle ? (
                <Text variant="caption" className="text-center text-base">
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
