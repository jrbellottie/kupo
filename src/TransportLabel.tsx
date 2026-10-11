import { getTransportPortColor, type TransportPreset } from "./utils/transport";

export default function TransportLabel({ label, ports }: {
  label: string;
  ports?: Pick<TransportPreset, "departurePort" | "arrivalPort">;
}) {
  const coloredPorts = ports
    ? [...new Set([ports.departurePort, ports.arrivalPort])].filter(port => getTransportPortColor(port))
    : [];
  if (!coloredPorts.length) return <>{label}</>;
  if (ports?.departurePort === ports?.arrivalPort) {
    return <span style={{ color: getTransportPortColor(ports?.departurePort) }}>{label}</span>;
  }
  const pattern = new RegExp(`(${coloredPorts.map(port => port.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return <>{label.split(pattern).map((part, index) => {
    const color = getTransportPortColor(part);
    return color ? <span key={index} style={{ color }}>{part}</span> : part;
  })}</>;
}
