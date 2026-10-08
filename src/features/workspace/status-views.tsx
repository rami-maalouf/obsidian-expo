/** native status views are ios ui; other platforms show the app shell only. */
export type NoticeProps = {
  title: string;
  systemImage: string;
  description: string;
  detail?: string;
  action?: { title: string; onPress: () => void };
};

export function Notice(_props: NoticeProps) {
  return null;
}

export function Busy(_props: { label: string }) {
  return null;
}
