<script setup>
import { computed, onMounted, ref, watch } from 'vue';

const site = ref(null);
const session = ref({ user: null, csrf: '' });
const applications = ref([]);
const selectedSeat = ref(null);
const selectedApplication = ref(null);
const currentRoom = ref(null);
const authMode = ref('login');
const account = ref({ username: '', name: '', password: '' });
const form = ref({ startDate: '', endDate: '', termId: '', purpose: '', outcome: '' });
const files = ref(null);
const decision = ref({ note: '' });
const busy = ref(false);
const error = ref('');
const notice = ref('');

async function api(path, options = {}) {
  const headers = { 'X-Requested-With': 'open-workstations', ...options.headers };
  if (session.value.csrf) headers['X-CSRF-Token'] = session.value.csrf;
  if (options.body && !(options.body instanceof FormData))
    headers['Content-Type'] = 'application/json';
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
async function refresh() {
  const [siteData, sessionData] = await Promise.all([api('/site'), api('/session')]);
  site.value = siteData;
  session.value = sessionData;
  currentRoom.value =
    siteData.rooms.find((room) => room.id === currentRoom.value?.id) ?? siteData.rooms[0];
  if (sessionData.user) applications.value = await api('/applications');
  else applications.value = [];
}
async function run(action, message = '') {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
    notice.value = message;
  } catch (cause) {
    error.value = cause.message;
  } finally {
    busy.value = false;
  }
}
async function authenticate() {
  await run(async () => {
    const data = await api(authMode.value === 'register' ? '/auth/register' : '/auth/login', {
      method: 'POST',
      body: JSON.stringify(
        authMode.value === 'register'
          ? account.value
          : { username: account.value.username, password: account.value.password },
      ),
    });
    session.value = data;
    account.value.password = '';
    await refresh();
  }, '已登录');
}
async function logout() {
  await run(async () => {
    await api('/auth/logout', { method: 'POST' });
    await refresh();
    selectedApplication.value = null;
  }, '已退出');
}
const seatType = computed(
  () => selectedSeat.value && site.value?.seatTypes[selectedSeat.value.type],
);
const myApplication = computed(
  () =>
    selectedSeat.value &&
    applications.value.find(
      (a) => a.seat_id === selectedSeat.value.id && ['pending', 'approved'].includes(a.status),
    ),
);
const monthEnd = (start) =>
  start
    ? new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10)
    : '';
watch(
  () => [selectedSeat.value?.id, form.value.startDate, form.value.termId],
  () => {
    if (!selectedSeat.value || !site.value) return;
    if (selectedSeat.value.type === 'rotating') form.value.endDate = monthEnd(form.value.startDate);
    if (selectedSeat.value.type === 'fixed') {
      const term = site.value.terms.find((t) => t.id === form.value.termId);
      if (term) {
        form.value.startDate = [site.value.today, term.start].sort().at(-1);
        form.value.endDate = term.end;
      }
    }
  },
);
function selectSeat(seat) {
  selectedSeat.value = seat;
  form.value = {
    startDate: site.value.today,
    endDate: site.value.today,
    termId: '',
    purpose: '',
    outcome: '',
  };
  files.value = null;
}
async function submitApplication() {
  await run(async () => {
    const payload = {
      ...form.value,
      seatId: selectedSeat.value.id,
      termId: form.value.termId || null,
    };
    const body = new FormData();
    body.append('payload', JSON.stringify(payload));
    for (const file of files.value?.files ?? []) body.append('files', file);
    await api('/applications', { method: 'POST', body });
    await refresh();
  }, '申请已提交，可在“我的申请”查看进度');
}
async function openApplication(id) {
  await run(async () => {
    selectedApplication.value = await api(`/applications/${id}`);
    decision.value.note = '';
  });
}
async function withdraw() {
  await run(async () => {
    await api(`/applications/${selectedApplication.value.id}/withdraw`, { method: 'POST' });
    selectedApplication.value = null;
    await refresh();
  }, '申请已撤回');
}
async function decide(value) {
  await run(
    async () => {
      await api(`/admin/applications/${selectedApplication.value.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision: value,
          note: decision.value.note,
          version: selectedApplication.value.version,
        }),
      });
      selectedApplication.value = null;
      await refresh();
    },
    value === 'approved' ? '已通过申请' : '已驳回申请',
  );
}
const statusLabel = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过',
  withdrawn: '已撤回',
  expired: '已到期',
};
const eligibleTerms = computed(
  () => site.value?.terms.filter((t) => t.end >= site.value.today) ?? [],
);
onMounted(() =>
  refresh().catch((cause) => {
    error.value = cause.message;
  }),
);
</script>

<template>
  <div class="shell" v-if="site">
    <header class="topbar">
      <div class="brand">
        <span class="brand-icon">▦</span>
        <div>
          <strong>{{ site.siteName }}</strong
          ><small>{{ site.organization }}</small>
        </div>
      </div>
      <div class="top-actions">
        <span class="today">{{ site.today }}</span
        ><span v-if="session.user" class="user"
          >{{ session.user.name }} ·
          {{ session.user.role === 'manager' ? '管理员' : '申请人' }}</span
        ><button v-if="session.user" class="text-button" @click="logout">退出登录</button>
      </div>
    </header>
    <main class="container">
      <div v-if="error" class="alert error" role="alert">
        {{ error }} <button @click="error = ''">关闭</button>
      </div>
      <div v-if="notice" class="alert success" role="status">
        {{ notice }} <button @click="notice = ''">关闭</button>
      </div>
      <section class="hero">
        <div>
          <span class="eyebrow">WORKSPACE REQUESTS</span>
          <h1>找到适合你的工位</h1>
          <p>查看空间布局与申请情况，按工位类型填写计划。申请是否通过，以审核结果为准。</p>
        </div>
        <div class="hero-metric">
          <strong>{{ site.rooms.reduce((sum, room) => sum + room.seats.length, 0) }}</strong
          ><span>个示例工位</span>
        </div>
      </section>
      <div class="layout">
        <section class="card map-card">
          <div class="section-heading">
            <div>
              <h2>空间布局</h2>
              <p>工位位置和类别由部署方配置</p>
            </div>
            <span class="badge" :class="site.applicationOpen ? 'open' : ''">{{
              site.applicationOpen ? '申请开放中' : '申请暂未开放'
            }}</span>
          </div>
          <div class="room-tabs">
            <button
              v-for="room in site.rooms"
              :key="room.id"
              :class="{ active: currentRoom?.id === room.id }"
              @click="
                currentRoom = room;
                selectedSeat = null;
              "
            >
              {{ room.name }}
            </button>
          </div>
          <p class="room-description">{{ currentRoom?.description }}</p>
          <div
            v-if="currentRoom"
            class="map-stage"
            :style="{ aspectRatio: `${currentRoom.width} / ${currentRoom.height}` }"
            aria-label="工位布局图"
          >
            <button
              v-for="seat in currentRoom.seats"
              :key="seat.id"
              class="map-seat"
              :class="[
                seat.type,
                { selected: selectedSeat?.id === seat.id, occupied: seat.occupied },
              ]"
              :style="{
                left: `${(100 * seat.x) / currentRoom.width}%`,
                top: `${(100 * seat.y) / currentRoom.height}%`,
                width: `${(100 * seat.width) / currentRoom.width}%`,
                height: `${(100 * seat.height) / currentRoom.height}%`,
              }"
              :aria-label="`${seat.id} ${site.seatTypes[seat.type].label}，${seat.occupied ? '当前使用中' : '可申请'}`"
              @click="selectSeat(seat)"
            >
              <strong>{{ seat.label }}</strong
              ><small>{{ site.seatTypes[seat.type].label }}</small>
            </button>
          </div>
          <div class="legend">
            <span><i class="dot flexible"></i>流动</span
            ><span><i class="dot rotating"></i>轮流</span><span><i class="dot fixed"></i>固定</span
            ><span><i class="dot occupied"></i>当前使用中</span>
          </div>
        </section>
        <aside class="card detail-card">
          <template v-if="selectedSeat">
            <span class="eyebrow">SEAT DETAIL</span>
            <h2>{{ selectedSeat.id }}</h2>
            <p class="type-title">{{ seatType.label }}</p>
            <p>{{ seatType.description }}</p>
            <div class="info-grid">
              <div>
                <span>当前状态</span
                ><strong>{{ selectedSeat.occupied ? '使用中' : '可申请' }}</strong>
              </div>
              <div>
                <span>待审核申请</span><strong>{{ selectedSeat.pendingCount }} 份</strong>
              </div>
            </div>
            <p class="subtle">
              同一工位可同时接受多份候选申请。审核通过时，系统会检查使用日期是否冲突。
            </p>
            <template v-if="session.user?.role === 'applicant' && site.applicationOpen">
              <p v-if="myApplication" class="inline-note">
                你已有该工位的 {{ statusLabel[myApplication.status] }} 申请。
              </p>
              <form v-else class="apply-form" @submit.prevent="submitApplication">
                <label v-if="selectedSeat.type === 'fixed'"
                  >申请学期<select v-model="form.termId" required>
                    <option value="">请选择</option>
                    <option v-for="term in eligibleTerms" :key="term.id" :value="term.id">
                      {{ term.label }} · 至 {{ term.end }}
                    </option>
                  </select></label
                >
                <div class="date-row">
                  <label
                    >开始日期<input
                      v-model="form.startDate"
                      type="date"
                      :min="site.today"
                      :readonly="selectedSeat.type === 'fixed'"
                      required /></label
                  ><label
                    >结束日期<input
                      v-model="form.endDate"
                      type="date"
                      :min="form.startDate"
                      :max="selectedSeat.type === 'rotating' ? monthEnd(form.startDate) : undefined"
                      :readonly="selectedSeat.type !== 'flexible'"
                      required
                  /></label>
                </div>
                <label
                  >使用计划<textarea
                    v-model="form.purpose"
                    rows="3"
                    minlength="20"
                    maxlength="3000"
                    placeholder="计划使用工位开展什么工作？"
                    required
                  ></textarea>
                </label>
                <label
                  >预期成果或已有产出<textarea
                    v-model="form.outcome"
                    rows="3"
                    minlength="10"
                    maxlength="2000"
                    placeholder="写明成果、进度或可供审核的依据"
                    required
                  ></textarea>
                </label>
                <label
                  >辅助材料（可选，最多 3 个，每个 5 MB）<input ref="files" type="file" multiple
                /></label>
                <button class="primary" type="submit" :disabled="busy">提交申请</button>
              </form>
            </template>
            <p v-else-if="!session.user" class="inline-note">登录后可提交申请。</p>
          </template>
          <div v-else class="empty-state">
            <span>▦</span>
            <h2>选择一个工位</h2>
            <p>点击左侧布局中的工位，查看类别、候选人数和申请方式。</p>
          </div>
        </aside>
      </div>
      <div class="below-grid">
        <section v-if="!session.user" class="card auth-card">
          <h2>{{ authMode === 'login' ? '登录账号' : '创建申请人账号' }}</h2>
          <p>示例项目使用本地账号。正式部署可接入本单位身份认证。</p>
          <form @submit.prevent="authenticate">
            <label
              >用户名<input
                v-model="account.username"
                autocomplete="username"
                required
                minlength="3" /></label
            ><label v-if="authMode === 'register'"
              >姓名<input
                v-model="account.name"
                autocomplete="name"
                required
                minlength="2" /></label
            ><label
              >密码<input
                v-model="account.password"
                type="password"
                :autocomplete="authMode === 'login' ? 'current-password' : 'new-password'"
                required
                minlength="12" /></label
            ><button class="primary" :disabled="busy">
              {{ authMode === 'login' ? '登录' : '注册并登录' }}
            </button>
          </form>
          <button
            v-if="site.registrationOpen"
            class="text-button"
            @click="authMode = authMode === 'login' ? 'register' : 'login'"
          >
            {{ authMode === 'login' ? '没有账号？注册' : '已有账号？登录' }}
          </button>
        </section>
        <section v-if="session.user" class="card list-card">
          <div class="section-heading">
            <div>
              <h2>{{ session.user.role === 'manager' ? '申请审核' : '我的申请' }}</h2>
              <p>
                {{
                  session.user.role === 'manager'
                    ? '所有管理员都能查看并处理申请'
                    : '查看进度和审核结果'
                }}
              </p>
            </div>
            <button class="text-button" @click="refresh">刷新</button>
          </div>
          <div v-if="!applications.length" class="list-empty">暂无申请记录</div>
          <button
            v-for="item in applications"
            :key="item.id"
            class="application-row"
            @click="openApplication(item.id)"
          >
            <span
              ><strong>{{ item.seat_id }}</strong
              ><small
                >{{ item.start_date }} — {{ item.end_date
                }}<template v-if="item.applicant_name">
                  · {{ item.applicant_name }}</template
                ></small
              ></span
            ><span class="status" :class="item.status">{{ statusLabel[item.status] }}</span>
          </button>
        </section>
        <section class="card rules-card">
          <h2>工位类型</h2>
          <div v-for="(type, key) in site.seatTypes" :key="key" class="rule">
            <i class="dot" :class="key"></i>
            <div>
              <strong>{{ type.label }}</strong>
              <p>{{ type.description }}</p>
            </div>
          </div>
          <p class="subtle">
            所有工位由部署单位统一管理。获批只代表在约定期限内获得使用资格，到期需重新申请。
          </p>
        </section>
      </div>
      <footer>Open Workstations · 开源项目示例界面</footer>
    </main>
    <div v-if="selectedApplication" class="modal-backdrop" @click.self="selectedApplication = null">
      <section class="modal" role="dialog" aria-modal="true" aria-label="申请详情">
        <button class="close" @click="selectedApplication = null" aria-label="关闭">×</button
        ><span class="eyebrow">APPLICATION</span>
        <h2>{{ selectedApplication.seat_id }} · {{ statusLabel[selectedApplication.status] }}</h2>
        <p>{{ selectedApplication.start_date }} — {{ selectedApplication.end_date }}</p>
        <p v-if="selectedApplication.applicant_name">
          申请人：{{ selectedApplication.applicant_name }}
        </p>
        <h3>使用计划</h3>
        <p class="prewrap">{{ selectedApplication.purpose }}</p>
        <h3>预期成果或已有产出</h3>
        <p class="prewrap">{{ selectedApplication.outcome }}</p>
        <h3>材料</h3>
        <p v-if="!selectedApplication.attachments.length" class="subtle">未上传附件</p>
        <a
          v-for="file in selectedApplication.attachments"
          :key="file.id"
          class="attachment"
          :href="`/api/attachments/${file.id}`"
          >{{ file.filename }} · {{ Math.ceil(file.size / 1024) }} KB</a
        >
        <h3>处理记录</h3>
        <p
          v-for="event in selectedApplication.events"
          :key="event.created_at + event.action"
          class="event"
        >
          {{ event.created_at.slice(0, 16).replace('T', ' ') }} · {{ event.note }}
        </p>
        <p v-if="selectedApplication.decision_note">
          审核意见：{{ selectedApplication.decision_note }}
        </p>
        <div
          v-if="session.user?.role === 'manager' && selectedApplication.status === 'pending'"
          class="decision-box"
        >
          <label
            >审核意见<textarea
              v-model="decision.note"
              minlength="3"
              maxlength="1000"
              rows="3"
              required
            ></textarea>
          </label>
          <div class="decision-actions">
            <button :disabled="busy || decision.note.trim().length < 3" @click="decide('rejected')">
              驳回</button
            ><button
              class="primary"
              :disabled="busy || decision.note.trim().length < 3"
              @click="decide('approved')"
            >
              通过
            </button>
          </div>
        </div>
        <button
          v-if="session.user?.role === 'applicant' && selectedApplication.status === 'pending'"
          class="text-button"
          @click="withdraw"
        >
          撤回这份申请
        </button>
      </section>
    </div>
  </div>
  <div v-else class="loading">
    正在加载工位信息…
    <p v-if="error">{{ error }}</p>
  </div>
</template>
