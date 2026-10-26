import '../src/shell/base.css';
import '../src/shell/shell.css';
import { mount } from '../src/shell/session';
import { DocEditor } from '../src/doc/DocEditor';

// 协同模式下在线状态走协同连接自己报，不用会话的心跳；普通模式（collab=0）才用心跳
const collab = new URLSearchParams(location.search).get('collab') !== '0';
mount((s) => <DocEditor session={s} />, { presenceEvery: collab ? 0 : 20_000, comments: true });
