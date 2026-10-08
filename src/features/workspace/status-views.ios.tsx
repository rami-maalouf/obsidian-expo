/**
 * native status views: an empty state with an optional action, and a busy indicator.
 */
import { Button, ContentUnavailableView, Host, ProgressView, Text, VStack } from '@expo/ui/swift-ui';
import { buttonStyle, controlSize, foregroundStyle, padding, tint } from '@expo/ui/swift-ui/modifiers';

import { Accent } from '@/constants/theme';

export type NoticeProps = {
  title: string;
  systemImage: Parameters<typeof ContentUnavailableView>[0]['systemImage'];
  description: string;
  detail?: string;
  action?: { title: string; onPress: () => void };
};

/** a native empty state with an optional action, used before the workspace opens. */
export function Notice({ title, systemImage, description, detail, action }: NoticeProps) {
  return (
    <Host style={{ flex: 1 }} modifiers={[tint(Accent)]}>
      <VStack spacing={16}>
        <ContentUnavailableView title={title} systemImage={systemImage} description={description} />
        {detail ? <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' }), padding({ horizontal: 24 })]}>{detail}</Text> : null}
        {action ? (
          <Button label={action.title} onPress={action.onPress} modifiers={[buttonStyle('glassProminent'), controlSize('large')]} />
        ) : null}
      </VStack>
    </Host>
  );
}

export function Busy({ label }: { label: string }) {
  return (
    <Host style={{ flex: 1 }}>
      <VStack spacing={12}>
        <ProgressView />
        <Text modifiers={[foregroundStyle({ type: 'hierarchical', style: 'secondary' })]}>{label}</Text>
      </VStack>
    </Host>
  );
}
