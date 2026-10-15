import { styles } from "./styles";
import { presetTimerDetails } from "./utils/presetTimerDetails";

type PresetTimerDetailsProps = {
  offsetText: string;
  offsetValue: number;
  reference: string;
  fireAtMs: number;
  nowMs: number;
};

export default function PresetTimerDetails({
  offsetText, offsetValue, reference, fireAtMs, nowMs,
}: PresetTimerDetailsProps) {
  const details = presetTimerDetails(offsetText, offsetValue, reference, fireAtMs, nowMs);
  return <div style={{ ...styles.sub, marginTop: 4, lineHeight: 1.45 }}>
    Offset: {details.offset}
    <br />
    Fires locally: {details.localFireTime} · In {details.timeUntil}
  </div>;
}
