const fs=require('fs');
for(const root of ['oxeio-monitor/','.release-pool/oxeio-monitor/']){
 const p=root+'web/src/pages/AllTargetsPage.tsx';let s=fs.readFileSync(p,'utf8');
 s=s.replace('  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.id));','  const selectableRows = rows.filter((r) => !r.skipReviewPending && r.status !== \'done\' && r.status !== \'deleted\');\n  const allPicked = selectableRows.length > 0 && selectableRows.every((r) => picked.has(r.id));');
 s=s.replace('new Set(rows.map((r) => r.id))','new Set(selectableRows.map((r) => r.id))');
 s=s.replace('aria-label="Select every row on this page"','aria-label="Select deletable targets on this page"\n              disabled={selectableRows.length === 0 || edit.busy || data.loading}');
 s=s.replace("aria-label={'Select ' + r.asin}","aria-label={'Select ' + r.asin}\n              disabled={r.skipReviewPending || r.status === 'done' || r.status === 'deleted' || edit.busy || data.loading}\n              title={r.skipReviewPending ? 'Decide the pending skip before deleting' : r.status === 'done' ? 'Finished work is protected' : r.status === 'deleted' ? 'Already deleted' : 'Select for deletion'}");
 s=s.replace('  const change = (next: () => void) => {','  const hasSearchFilters = q.trim() !== \'\' || activeFilters > 0 || (showQueues && filter !== \'all\');\n  const resetFilters = () => {\n    setPage(1); setQ(\'\'); setStaffId(\'\'); setAddedById(\'\'); setFrom(\'\'); setTo(\'\'); setFilter(lockedStage ?? \'all\');\n    setPicked(new Set()); setConfirmingBulk(false);\n  };\n  const skipDates = filter === \'to_review\' || filter === \'skipped\';\n\n  const change = (next: () => void) => {');
 s=s.replace('`${data.data.total} in total · newest activity first`','`${data.data.total.toLocaleString()} matching targets · ${skipDates ? \'pending reviews first, then newest skip request\' : \'newest activity first\'}`');
 s=s.replace('            value={statusValue}','            aria-label="Target status"\n            value={statusValue}');
 s=s.replace('          value={q}','          aria-label="Search ASIN or job number"\n          value={q}');
 s=s.replace('      {/*\r\n        ⚠️⚠️ লিঙ্ক পেস্ট করলে','      {/*\r\n        ⚠️⚠️ লিঙ্ক পেস্ট করলে');
 const anchor='      {looksLikeUrl && (';
 s=s.replace(anchor,`      <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
        <MiniButton disabled={data.loading || edit.busy} onClick={() => { data.reload(); stats.reload(); }}>Refresh</MiniButton>
        {hasSearchFilters && <MiniButton onClick={resetFilters}>Reset all filters</MiniButton>}
        {data.loading && <span role="status" className="text-xs text-ink-3">Loading targets…</span>}
      </div>
      ${anchor.trimStart()}`);
 s=s.replace('            value={staffId}','            aria-label="Designer"\n            value={staffId}').replace('            value={addedById}','            aria-label="Added by"\n            value={addedById}');
 s=s.replace('              value={from}','              max={to || undefined}\n              value={from}').replace('              value={to}','              min={from || undefined}\n              value={to}');
 s=s.replace('      <div className="px-4">\r\n        <ServerError error={edit.error} />',`      {(from || to) && <p className="px-4 pb-2 text-xs text-ink-3">
        {skipDates ? 'Dates refer to skip requests in Dhaka time. Clear dates to include legacy skips without a recorded time and deleted targets.' : filter === 'done' ? 'Dates refer to completion time in Dhaka time, including designs uploaded or made live later.' : 'Dates refer to the latest recorded target activity in Dhaka time.'}
      </p>}
      <div className="px-4">
        <ServerError error={edit.error} />`);
 s=s.replace('          Nothing matches that.','          No targets match your search or filters.\n          {hasSearchFilters && <button type="button" onClick={resetFilters} className="ml-2 text-data hover:underline">Reset all filters</button>}');
 s=s.replace('                  Delete\r\n                </MiniButton>','                  Delete {picked.size} selected\r\n                </MiniButton>');
 s=s.replace('Finished\r\n                  designs in the selection are left alone.','Finished\r\n                  designs and pending skip reviews are protected.');
 s=s.replace('disabled={data.data.page <= 1}','disabled={data.loading || data.data.page <= 1}').replace('disabled={data.data.page >= data.data.pages}','disabled={data.loading || data.data.page >= data.data.pages}');
 s=s.replace("<MiniButton disabled={busy} onClick={() => setOpen(true)}>","<MiniButton aria-label={'More actions for ' + row.asin} disabled={busy} onClick={() => setOpen(true)}>");
 s=s.replace('{mayDelete && (\r\n        <MiniButton tone="danger"',"{mayDelete && row.status !== 'done' && (\r\n        <MiniButton tone=\"danger\"");
 fs.writeFileSync(p,s);
 const c=root+'server/src/targets/targets.controller.ts';let t=fs.readFileSync(c,'utf8').replace("  @Post('delete')","  @Roles(UserRole.owner, UserRole.manager)\n  @Post('delete')").replace("  @Delete(':id')","  @Roles(UserRole.owner, UserRole.manager)\n  @Delete(':id')");fs.writeFileSync(c,t);
 const v=root+'server/src/targets/targets.service.ts';t=fs.readFileSync(v,'utf8');t=t.replace('? { skipRequestedAt: activity } : { lastActivityAt: activity })','? { skipRequestedAt: activity } : query.status === \'done\' ? { completedAt: activity } : { lastActivityAt: activity })');
 t=t.replace('where: { id, [prerequisite]: { not: null }, [stage]: null },',`where: { id, status: DesignTargetStatus.done, skipReviewPending: false,
        [prerequisite]: { not: null }, [stage]: null,
        ...(stage === 'uploadedAt' ? { OR: [{ errorFoundAt: null }, { fixedAt: { not: null } }] } : {}),
      },`);
 t=t.replace('select: { completedAt: true, errorFoundAt: true, uploadedAt: true,','select: { status: true, skipReviewPending: true, completedAt: true, errorFoundAt: true, uploadedAt: true,');
 t=t.replace("    if (target[prerequisite] === null) throw new BadRequestException(invalidMessage);",`    if (target.status !== DesignTargetStatus.done || target.skipReviewPending)
      throw new BadRequestException('Only completed designs can advance through production stages.');
    if (target[prerequisite] === null) throw new BadRequestException(invalidMessage);
    if (stage === 'uploadedAt' && target.errorFoundAt !== null && target.fixedAt === null)
      throw new BadRequestException('Fix the recorded spelling error before uploading this design.');`);
 fs.writeFileSync(v,t);
}
