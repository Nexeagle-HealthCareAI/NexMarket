'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type Task = {
  id: string;
  title: string;
  type: 'Panchayat' | 'Block' | 'FollowUp';
  status: 'Pending' | 'In Progress' | 'Completed';
  target: string;
};

type Agent = {
  id: string;
  name: string;
  role: string;
  district: string;
  assignedTasks: Task[];
};

const initialTasks: Task[] = [
  { id: 't1', title: 'Visit Mukhiya', type: 'Panchayat', status: 'Pending', target: 'Baisi' },
  { id: 't2', title: 'Survey Health Center', type: 'Block', status: 'Pending', target: 'Amour' },
  { id: 't3', title: 'Follow-up with Lead', type: 'FollowUp', status: 'Pending', target: 'Raju Traders' },
  { id: 't4', title: 'Distribute Pamphlets', type: 'Panchayat', status: 'Pending', target: 'Dagarua' },
  { id: 't5', title: 'Meet Ward Members', type: 'Panchayat', status: 'Pending', target: 'Rupauli' },
];

const initialAgents: Agent[] = [
  {
    id: 'ADM-9001',
    name: 'Suresh Sinha',
    role: 'Admin',
    district: 'HQ',
    assignedTasks: [],
  },
  {
    id: 'FLD-2001',
    name: 'Anjali Sharma',
    role: 'Field Officer',
    district: 'Purnia',
    assignedTasks: [
      { id: 't10', title: 'Initial Survey', type: 'Panchayat', status: 'In Progress', target: 'Kasba' }
    ],
  },
  {
    id: 'FLD-2002',
    name: 'Rahul Verma',
    role: 'Field Agent',
    district: 'Kishanganj',
    assignedTasks: [],
  }
];

export default function AssignmentsClient() {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [unassignedTasks, setUnassignedTasks] = useState<Task[]>(initialTasks);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(agents[1].id);
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);

  const selectedAgent = agents.find(a => a.id === selectedAgentId);

  const handleAssignTask = (task: Task) => {
    if (!selectedAgentId) return;

    // Animation trigger
    setAssigningTaskId(task.id);

    // Broadcast Push Notification
    if (typeof window !== 'undefined') {
      const channel = new BroadcastChannel('nexmarket-notifications');
      channel.postMessage({
        title: 'New Task Assigned! 🎯',
        body: `You have been assigned to ${task.title} at ${task.target}.`,
      });
      channel.close();
    }

    setTimeout(() => {
      setUnassignedTasks(prev => prev.filter(t => t.id !== task.id));
      setAgents(prev => prev.map(agent => {
        if (agent.id === selectedAgentId) {
          return { ...agent, assignedTasks: [...agent.assignedTasks, task] };
        }
        return agent;
      }));
      setAssigningTaskId(null);
    }, 400); // Wait for exit animation
  };

  const handleRevokeTask = (task: Task, agentId: string) => {
    setAgents(prev => prev.map(agent => {
      if (agent.id === agentId) {
        return { ...agent, assignedTasks: agent.assignedTasks.filter(t => t.id !== task.id) };
      }
      return agent;
    }));
    setUnassignedTasks(prev => [{ ...task, status: 'Pending' }, ...prev]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.25rem 0' }}>
            Task & Route Assignments
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem' }}>
            Assign regional targets to field agents and track their progress.
          </p>
        </div>
        <button
          className="btn btn-primary"
          style={{ gap: '0.5rem', display: 'flex', alignItems: 'center' }}
        >
          <span>➕</span> Create New Task
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'start' }}>
        {/* Left Column: Unassigned Tasks */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(16px)',
          borderRadius: '16px',
          border: '1px solid var(--surface-border)',
          padding: '1.5rem',
          boxShadow: '0 10px 30px rgba(0,0,0,0.02)'
        }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#1e293b', margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: '#f1f5f9', borderRadius: '50%', fontSize: '0.9rem' }}>
              {unassignedTasks.length}
            </span>
            Unassigned Tasks
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <AnimatePresence>
              {unassignedTasks.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-tertiary)' }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🎉</div>
                  <p>All tasks have been assigned!</p>
                </motion.div>
              )}
              {unassignedTasks.map((task) => (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 50, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    background: '#fff',
                    border: '1px solid var(--surface-border)',
                    borderRadius: '12px',
                    padding: '1.25rem',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  {assigningTaskId === task.id && (
                    <motion.div
                      initial={{ left: '-100%' }}
                      animate={{ left: '100%' }}
                      transition={{ duration: 0.4 }}
                      style={{
                        position: 'absolute',
                        top: 0, bottom: 0, width: '50%',
                        background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.1), transparent)',
                        zIndex: 10
                      }}
                    />
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <span style={{ 
                          fontSize: '0.7rem', 
                          fontWeight: 600, 
                          textTransform: 'uppercase', 
                          letterSpacing: '0.05em',
                          color: task.type === 'Panchayat' ? '#10b981' : task.type === 'Block' ? '#3b82f6' : '#f59e0b',
                          background: task.type === 'Panchayat' ? '#ecfdf5' : task.type === 'Block' ? '#eff6ff' : '#fffbeb',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px'
                        }}>
                          {task.type}
                        </span>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>#{task.id}</span>
                      </div>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: '#334155' }}>
                        {task.title}
                      </h3>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Target: <strong style={{ color: '#0f172a' }}>{task.target}</strong>
                      </p>
                    </div>
                    
                    <button
                      onClick={() => handleAssignTask(task)}
                      disabled={!selectedAgentId || assigningTaskId === task.id}
                      style={{
                        background: selectedAgentId ? 'var(--color-primary-50)' : '#f1f5f9',
                        color: selectedAgentId ? 'var(--color-primary-600)' : '#94a3b8',
                        border: 'none',
                        padding: '0.5rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: selectedAgentId ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem'
                      }}
                      onMouseOver={e => {
                        if (selectedAgentId) {
                          e.currentTarget.style.background = 'var(--color-primary-600)';
                          e.currentTarget.style.color = '#fff';
                        }
                      }}
                      onMouseOut={e => {
                        if (selectedAgentId) {
                          e.currentTarget.style.background = 'var(--color-primary-50)';
                          e.currentTarget.style.color = 'var(--color-primary-600)';
                        }
                      }}
                    >
                      Assign <span>→</span>
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Column: Agents & Their Tasks */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Agent Selector */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(16px)',
            borderRadius: '16px',
            border: '1px solid var(--surface-border)',
            padding: '1.5rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.02)'
          }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1e293b', margin: '0 0 1rem 0' }}>
              Select Field Agent
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {agents.filter(a => a.role !== 'Admin').map(agent => (
                <div
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem',
                    borderRadius: '12px',
                    border: '2px solid',
                    borderColor: selectedAgentId === agent.id ? 'var(--color-primary-500)' : 'transparent',
                    background: selectedAgentId === agent.id ? '#f8fafc' : '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: selectedAgentId === agent.id ? '0 4px 12px rgba(99,102,241,0.1)' : '0 1px 3px rgba(0,0,0,0.05)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: 'linear-gradient(135deg, #e2e8f0, #cbd5e1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, color: '#475569'
                    }}>
                      {agent.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '1rem' }}>{agent.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{agent.district} • {agent.id}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary-600)' }}>
                      {agent.assignedTasks.length}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                      Tasks
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Selected Agent's Tasks */}
          {selectedAgent && (
            <div style={{
              background: '#fff',
              borderRadius: '16px',
              border: '1px solid var(--color-primary-100)',
              padding: '1.5rem',
              boxShadow: '0 10px 40px rgba(99,102,241,0.08)'
            }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#1e293b', margin: '0 0 1.5rem 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Assignments for <span style={{ color: 'var(--color-primary-600)' }}>{selectedAgent.name}</span></span>
                <span style={{ fontSize: '0.85rem', background: '#f1f5f9', padding: '0.25rem 0.75rem', borderRadius: '12px', color: '#64748b' }}>
                  {selectedAgent.assignedTasks.length} Active
                </span>
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <AnimatePresence>
                  {selectedAgent.assignedTasks.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-tertiary)' }}
                    >
                      No tasks assigned yet. Select a task from the left to assign.
                    </motion.div>
                  )}
                  {selectedAgent.assignedTasks.map((task) => (
                    <motion.div
                      key={task.id}
                      layout
                      initial={{ opacity: 0, x: -50 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.2 }}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '1rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                        borderLeft: '4px solid var(--color-primary-500)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#334155' }}>
                            {task.title}
                          </h4>
                          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            Target: <strong>{task.target}</strong>
                          </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{ 
                            fontSize: '0.75rem', 
                            fontWeight: 600,
                            padding: '0.25rem 0.6rem',
                            borderRadius: '12px',
                            background: task.status === 'In Progress' ? '#dbeafe' : '#f1f5f9',
                            color: task.status === 'In Progress' ? '#2563eb' : '#64748b',
                          }}>
                            {task.status}
                          </span>
                          <button
                            onClick={() => handleRevokeTask(task, selectedAgent.id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '0.25rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px'
                            }}
                            title="Revoke Assignment"
                            onMouseOver={e => e.currentTarget.style.background = '#fee2e2'}
                            onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                          >
                            ✖
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
