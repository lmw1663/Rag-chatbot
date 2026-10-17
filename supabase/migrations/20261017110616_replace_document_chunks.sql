-- 문서 1개를 재인제스트할 때 쓰는 함수: 문서 upsert → 기존 청크 삭제 → 새 청크 삽입을 한 트랜잭션에서 처리한다.
-- 함수 본문은 하나의 트랜잭션으로 실행되므로, 중간에 실패하면 전부 되돌아가 "청크가 빈 문서"가 남지 않는다.
--
-- p_chunks: [{ "chunk_index": 0, "heading": "재고 > 실사" | null, "content": "...", "embedding": [0.1, ...] }, ...]
-- 반환값: documents.id
create function public.replace_document_chunks(
  p_slug text,
  p_title text,
  p_category text,
  p_content_hash text,
  p_embedding_model text,
  p_chunks jsonb
)
returns bigint
language plpgsql
security invoker -- 호출한 역할(service_role)의 권한으로 실행한다
set search_path = '' -- 모든 이름을 스키마까지 적어 search_path 조작을 막는다
as $$
declare
  v_document_id bigint;
begin
  if jsonb_typeof(p_chunks) is distinct from 'array' then
    raise exception 'p_chunks는 JSON 배열이어야 합니다';
  end if;

  insert into public.documents (slug, title, category, content_hash)
  values (p_slug, p_title, p_category, p_content_hash)
  on conflict (slug) do update
    set title = excluded.title,
        category = excluded.category,
        content_hash = excluded.content_hash,
        updated_at = now()
  returning id into v_document_id;

  delete from public.chunks where document_id = v_document_id;

  -- embedding은 JSON 배열 텍스트("[0.1,0.2,...]")가 pgvector 입력 형식과 같아서 그대로 캐스팅한다.
  -- 차원이 1024가 아니면 여기서 에러가 나고 전체가 롤백된다.
  insert into public.chunks (document_id, chunk_index, heading, content, embedding, embedding_model)
  select
    v_document_id,
    (c ->> 'chunk_index')::int,
    c ->> 'heading',
    c ->> 'content',
    (c -> 'embedding')::text::extensions.vector(1024),
    p_embedding_model
  from jsonb_array_elements(p_chunks) as c;

  return v_document_id;
end;
$$;

-- 서버(service_role)만 호출할 수 있게 한다. PUBLIC 기본 실행 권한도 명시적으로 회수한다.
revoke execute on function public.replace_document_chunks(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_document_chunks(text, text, text, text, text, jsonb)
  to service_role;
