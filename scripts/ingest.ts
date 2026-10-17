// 매뉴얼 인제스트: manuals/**/*.md → 청킹 → Voyage 임베딩(document) → replace_document_chunks로 문서 단위 교체.
// 실행: npm run ingest            (내용이 바뀐 문서만)
//       npm run ingest -- --force (모든 문서를 다시 임베딩. 청커를 바꿨을 때 사용)
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { chunkMarkdown } from "../lib/chunk-markdown";
import { EMBEDDING_MODEL, embedTexts } from "../lib/embed";
import { getSupabaseServer } from "../lib/supabase-server";

const MANUALS_DIR = path.join(process.cwd(), "manuals");

type ExistingDocument = {
  slug: string;
  content_hash: string;
  chunks: { embedding_model: string }[];
};

async function main() {
  loadEnvConfig(process.cwd()); // Next.js와 같은 방식으로 .env.local을 읽는다
  const force = process.argv.includes("--force");
  const supabase = getSupabaseServer();

  const files = await listManualFiles();
  if (files.length === 0) throw new Error(`매뉴얼이 없습니다: ${MANUALS_DIR}`);

  const { data, error } = await supabase.from("documents").select("slug, content_hash, chunks(embedding_model)");
  if (error) throw new Error(`기존 문서 조회 실패: ${error.message}`);
  const existing = new Map((data as ExistingDocument[]).map((doc) => [doc.slug, doc]));

  const summary = { ingested: 0, skipped: 0, failed: 0 };

  for (const file of files) {
    // slug는 manuals/ 기준 상대 경로에서 .md를 뗀 값 (예: "fryer-oil", "drive/drive-thru")
    const slug = file.replace(/\.md$/, "").split(path.sep).join("/");
    try {
      const markdown = await readFile(path.join(MANUALS_DIR, file), "utf8");
      const contentHash = createHash("sha256").update(markdown).digest("hex");

      if (!force && isUpToDate(existing.get(slug), contentHash)) {
        summary.skipped++;
        console.log(`- 건너뜀  ${slug} (변경 없음)`);
        continue;
      }

      const { title, category, chunks } = chunkMarkdown(markdown);
      if (chunks.length === 0) {
        summary.skipped++;
        console.warn(`! 건너뜀  ${slug} (청크 없음: 빈 문서인지 확인)`);
        continue;
      }
      if (!category) console.warn(`! 경고    ${slug} (category 없음: frontmatter 확인)`);

      const embeddings = await embedTexts(chunks.map((c) => c.content), "document");

      const { error: rpcError } = await supabase.rpc("replace_document_chunks", {
        p_slug: slug,
        p_title: title ?? path.basename(slug),
        p_category: category,
        p_content_hash: contentHash,
        p_embedding_model: EMBEDDING_MODEL,
        p_chunks: chunks.map((chunk, i) => ({
          chunk_index: chunk.chunkIndex,
          heading: chunk.heading,
          content: chunk.content,
          embedding: embeddings[i],
        })),
      });
      if (rpcError) throw new Error(rpcError.message);

      summary.ingested++;
      console.log(`+ 저장    ${slug} (청크 ${chunks.length}개)`);
    } catch (err) {
      // 한 문서가 실패해도 나머지는 계속 처리하고, 마지막에 실패 종료 코드를 남긴다.
      summary.failed++;
      process.exitCode = 1;
      console.error(`x 실패    ${slug}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 파일은 지웠는데 DB에 남은 문서. 자동 삭제는 하지 않고 알려만 준다.
  const fileSlugs = new Set(files.map((f) => f.replace(/\.md$/, "").split(path.sep).join("/")));
  for (const slug of existing.keys()) {
    if (!fileSlugs.has(slug)) console.warn(`! 경고    ${slug} (DB에만 있는 문서: manuals/에서 삭제됨)`);
  }

  console.log(`\n완료: 저장 ${summary.ingested}, 건너뜀 ${summary.skipped}, 실패 ${summary.failed}`);
}

// 내용 해시가 같고, 모든 청크가 현재 임베딩 모델로 만들어졌으면 다시 할 필요가 없다.
function isUpToDate(doc: ExistingDocument | undefined, contentHash: string): boolean {
  if (!doc || doc.content_hash !== contentHash || doc.chunks.length === 0) return false;
  return doc.chunks.every((c) => c.embedding_model === EMBEDDING_MODEL);
}

async function listManualFiles(): Promise<string[]> {
  const entries = await readdir(MANUALS_DIR, { recursive: true });
  return entries.filter((entry) => entry.endsWith(".md")).sort();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
