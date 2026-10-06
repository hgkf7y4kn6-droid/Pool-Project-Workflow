import { styled } from "nativewind";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

// SafeAreaView is a third-party component, so NativeWind needs styled()
// to enable className support on it.
export const SafeAreaView = styled(RNSafeAreaView);
