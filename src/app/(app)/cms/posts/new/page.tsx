import PostEditor from '../[id]/page';

export default function NewPostPage() {
  // Pass a resolved promise to satisfy the Promise<{id}> signature
  return <PostEditor params={Promise.resolve({ id: 'new' })} />;
}
