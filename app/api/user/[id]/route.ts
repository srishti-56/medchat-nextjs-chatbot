import { auth } from '@/app/(auth)/auth';
import { getUserById } from '@/lib/db/queries';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();

  if (!session || !session.user || !session.user.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Only allow users to fetch their own info
  if (session.user.id !== params.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const user = await getUserById(params.id);
    
    if (!user) {
      return new Response('User not found', { status: 404 });
    }

    return new Response(JSON.stringify(user), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Failed to fetch user:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
} 