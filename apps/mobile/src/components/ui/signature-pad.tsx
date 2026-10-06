import { useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { captureRef } from "react-native-view-shot";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "./button";
import { Text } from "./text";

/**
 * Finger signature capture. Exports a PNG data URL that is stored with the
 * approval / change order / inspection as the electronic signature.
 */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const { colors } = useTheme();
  const ref = useRef<View>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const current = useRef("");
  const [, force] = useState(0);

  const commit = async (next: string[]) => {
    setPaths(next);
    if (!next.length || !ref.current) return onChange(null);
    try {
      const b64 = await captureRef(ref, { format: "png", quality: 0.8, result: "base64", width: 600 });
      onChange(`data:image/png;base64,${b64}`);
    } catch {
      onChange(null);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        current.current = `M${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
        force((n) => n + 1);
      },
      onPanResponderMove: (e) => {
        current.current += ` L${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
        force((n) => n + 1);
      },
      onPanResponderRelease: () => {
        const stroke = current.current;
        current.current = "";
        setPaths((prev) => {
          const next = [...prev, stroke];
          void commit(next);
          return next;
        });
      },
    }),
  ).current;

  return (
    <View className="gap-2">
      <View accessible accessibilityLabel="Signature area. Sign with your finger." className="overflow-hidden rounded-xl border-2 border-dashed border-border">
        <View ref={ref} collapsable={false} style={{ height: 180, backgroundColor: "#ffffff" }} {...responder.panHandlers}>
          <Svg width="100%" height="100%">
            {[...paths, current.current].filter(Boolean).map((d, i) => (
              <Path key={i} d={d} stroke="#0d1a26" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </Svg>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text variant="caption" style={{ color: colors.mutedForeground }}>
          Sign above
        </Text>
        <Button label="Clear" variant="ghost" size="sm" icon="refresh" onPress={() => void commit([])} />
      </View>
    </View>
  );
}
