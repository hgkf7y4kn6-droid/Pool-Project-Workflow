import { useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { signatureToPng, type Stroke } from "@/lib/signature-png";
import { Button } from "./button";
import { Text } from "./text";

const toPath = (s: Stroke) => s.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

/**
 * Finger/mouse signature capture. Strokes are rasterized to a PNG data URL in
 * JavaScript and stored with the approval, change order or inspection.
 */
export function SignaturePad({ onChange, height = 180 }: { onChange: (dataUrl: string | null) => void; height?: number }) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const current = useRef<Stroke>([]);
  const width = useRef(300);
  const [, force] = useState(0);

  const emit = (next: Stroke[]) => {
    setStrokes(next);
    onChange(next.some((s) => s.length > 1) ? signatureToPng(next, width.current, height) : null);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        current.current = [{ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }];
        force((n) => n + 1);
      },
      onPanResponderMove: (e) => {
        current.current.push({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
        force((n) => n + 1);
      },
      onPanResponderRelease: () => {
        const stroke = current.current;
        current.current = [];
        setStrokes((prev) => {
          const next = [...prev, stroke];
          queueMicrotask(() => emit(next));
          return next;
        });
      },
    }),
  ).current;

  return (
    <View className="gap-2">
      <View accessible accessibilityLabel="Signature area. Sign with your finger." className="overflow-hidden rounded-xl border-2 border-dashed border-border">
        <View onLayout={(e) => (width.current = e.nativeEvent.layout.width)} style={{ height, backgroundColor: "#ffffff" }} {...responder.panHandlers}>
          <Svg width="100%" height="100%">
            {[...strokes, current.current].filter((s) => s.length).map((s, i) => (
              <Path key={i} d={toPath(s)} stroke="#0d1a26" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </Svg>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text variant="caption">Sign above</Text>
        <Button label="Clear" variant="ghost" size="sm" icon="refresh" onPress={() => emit([])} />
      </View>
    </View>
  );
}
