import PostEditor from '../[id]/page';

// "new" is just the editor with id="new"
export default function NewPostPage() {
  return <PostEditor params={{ id: 'new' }} />;
}
