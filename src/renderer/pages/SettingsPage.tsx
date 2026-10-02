import SettingsTabContent from '../components/SettingsTabContent';
import SubscriptionsPage from './SubscriptionsPage';

export default function SettingsPage() {
  return (
    <div className="settings-page">
      <header className="settings-center-header">
        <div>
          <h1>设置</h1>
          <p>管理账户连接、用量刷新和悬浮球行为</p>
        </div>
      </header>
      <div className="settings-page__body settings-center__body">
        <section
          id="accounts"
          className="settings-center__section settings-center__section--accounts"
          aria-label="账户与订阅"
        >
          <div className="settings-center__section-heading">
            <div>
              <h2>账户与订阅</h2>
              <p>优先处理未配置或查询失败的账户，再查看额度和明细。</p>
            </div>
          </div>
          <SubscriptionsPage />
        </section>
        <section
          id="preferences"
          className="settings-center__section settings-center__section--preferences"
          aria-label="运行行为与外观"
        >
          <div className="settings-center__section-heading">
            <div>
              <h2>运行行为与外观</h2>
              <p>自动刷新和统计口径影响所有账户；悬浮球和图标为低频偏好。</p>
            </div>
          </div>
          <SettingsTabContent />
        </section>
      </div>
    </div>
  );
}
