"""Targeted refresh must not rebuild source voice when only background MDT changes."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import rebuild_voice_ui as pipeline

class TargetedPipelineTest(unittest.TestCase):
    def test_staging_commands_bind_both_grid_outputs_and_termination_to_public(self):
        self.assertTrue(hasattr(pipeline,'targeted_commands'),'Targeted staging commands are required')
        public=Path('fixture-stage/public')
        commands=pipeline.targeted_commands(public)
        self.assertEqual([n for n,_ in commands],['mdt-grid','candidate-termination'])
        grid=commands[0][1];term=commands[1][1]
        self.assertIn(str(public/'quality-improvement/mdt-grid-25m-v1.json'),grid)
        self.assertIn(str(public/'quality-improvement/mdt-grid-analysis-v1.json'),grid)
        self.assertIn('--public-dir',term);self.assertIn(str(public),term)
    def test_grid_only_staleness_runs_only_grid_refresh(self):
        self.assertTrue(hasattr(pipeline,'refresh_targeted'),'Independent targeted freshness is required')
        commands=[]
        with patch.object(pipeline,'grid_ready',return_value=False),patch.object(pipeline,'termination_ready',return_value=True):
            pipeline.refresh_targeted(Path('public'),'fixture',runner=commands.append)
        self.assertEqual(len(commands),1);self.assertIn('scripts/build-mdt-25m-grid.py',commands[0])
        self.assertFalse(any('build_voice_1030.py' in c for c in commands))
    def test_missing_artifacts_are_not_current(self):
        self.assertTrue(hasattr(pipeline,'grid_ready'),'Targeted grid readiness is required')
        with tempfile.TemporaryDirectory() as t:
            public=Path(t)
            self.assertFalse(pipeline.grid_ready(public))
            self.assertFalse(pipeline.termination_ready(public,'fixture'))

if __name__=='__main__':unittest.main()
