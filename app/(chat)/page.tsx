import { generateUUID } from '@/lib/utils';
import { Chat } from '@/components/chat';
import { DEFAULT_MODEL_NAME } from '@/lib/ai/models';
import { auth } from '@/app/(auth)/auth';
import { getUser } from '@/lib/db/queries';
import { notFound } from 'next/navigation';

export default async function Page() {
  const session = await auth();

  if (!session?.user?.id) {
    notFound();
  }

  const id = generateUUID();

  // Get user info
  const users = await getUser(session.user.email || '');
  const user = users[0];
  const userInfo = user ? {
    name: user.name,
    age: user.age
  } : undefined;

  return (
    <>
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        selectedModelId={DEFAULT_MODEL_NAME}
        selectedVisibilityType="private"
        isReadonly={false}
        userId={session.user.id}
        userInfo={userInfo}
      />
    </>
  );
}
