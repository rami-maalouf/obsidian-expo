/** the status views have ios and android versions; the web shell shows nothing. */
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
