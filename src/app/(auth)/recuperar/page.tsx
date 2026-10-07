import type { Metadata } from "next";
import { RecoverForm } from "./recover-form";

export const metadata: Metadata = { title: "Restablecer contraseña" };

export default function RecoverPage() {
  return <RecoverForm />;
}
