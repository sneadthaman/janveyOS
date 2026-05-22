import { Link, Navigate, Route, Routes } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { UploadDetailPage } from "./pages/UploadDetailPage";
import { KnowledgeInboxPage } from "./pages/KnowledgeInboxPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { PlaybooksPage } from "./pages/PlaybooksPage";
import { IngestPage } from "./pages/IngestPage";
import { AgentActivityPage } from "./pages/AgentActivityPage";
import { AgentActionsPage } from "./pages/AgentActionsPage";

export function App() {
  return (
    <div className="layout">
      <header className="header">
        <h1>Janvey OS Manager Console</h1>
        <nav className="nav">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/knowledge">Knowledge Inbox</Link>
          <Link to="/recommendations">Recommendations</Link>
          <Link to="/playbooks">Playbooks</Link>
          <Link to="/ingest">Ingest URL</Link>
          <Link to="/agent-activity">Agent Activity</Link>
          <Link to="/agent-actions">Agent Actions</Link>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/uploads/:id" element={<UploadDetailPage />} />
          <Route path="/knowledge" element={<KnowledgeInboxPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/playbooks" element={<PlaybooksPage />} />
          <Route path="/ingest" element={<IngestPage />} />
          <Route path="/agent-activity" element={<AgentActivityPage />} />
          <Route path="/agent-actions" element={<AgentActionsPage />} />
        </Routes>
      </main>
    </div>
  );
}
