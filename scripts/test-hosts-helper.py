import hashlib
import importlib.machinery
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
loader=importlib.machinery.SourceFileLoader("helper",str(Path(__file__).with_name("dockmaster-hosts-helper")))
spec=importlib.util.spec_from_loader(loader.name,loader)
helper=importlib.util.module_from_spec(spec)
loader.exec_module(helper)
class HostsHelperTests(unittest.TestCase):
 def test_validation_and_fixed_parameters(self):
  for req in [{"expected":"a"*64,"content":"127.0.0.1 localhost","path":"/other"},{"expected":"a"*64,"content":"# 127.0.0.1 localhost"}]:
   with self.assertRaises(ValueError):helper.validate(req)
 def test_atomic_update_backup_and_stale_rejection(self):
  with tempfile.TemporaryDirectory() as directory:
   hosts=os.path.join(directory,"hosts");state=os.path.join(directory,"state")
   old=b"127.0.0.1 localhost\n";new=old+b"127.0.0.1 test.local\n"
   Path(hosts).write_bytes(old);digest=hashlib.sha256(old).hexdigest()
   self.assertTrue(helper.apply(new,digest,hosts,state))
   self.assertEqual(Path(hosts).read_bytes(),new)
   self.assertEqual(next(Path(state).glob("*.backup")).read_bytes(),old)
   self.assertFalse(helper.apply(old,digest,hosts,state))
 def test_symlink_refusal(self):
  with tempfile.TemporaryDirectory() as directory:
   real=Path(directory)/"real";real.write_text("127.0.0.1 localhost\n")
   hosts=Path(directory)/"hosts";hosts.symlink_to(real)
   with self.assertRaises(OSError):helper.apply(b"127.0.0.1 localhost\n","a"*64,str(hosts),str(Path(directory)/"state"))
if __name__=="__main__":unittest.main()
