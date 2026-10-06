import Ionicons from "@expo/vector-icons/Ionicons";
import { styled } from "nativewind";
import type { ComponentProps } from "react";

// Ionicons with className support (size and color via text-* classes).
export const Icon = styled(Ionicons);
export type IconName = ComponentProps<typeof Ionicons>["name"];
