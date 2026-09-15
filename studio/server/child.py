"""One analyzer run, in a process of its own. Started by nlp_run.run(); not run by hand.

    python child.py <analyzers folder> <analyzer name>   < input text (UTF-8)

It prints nlp_run.DONE once the engine returns, and nothing else of its own: the
server reads the run's results from the files the engine wrote.
"""
import os
import sys

from nlp_run import DONE, LIMITS_ENV


def limit_resources() -> None:
    # POSIX only, and applied here rather than through Popen(preexec_fn=...), which
    # is unsafe in a threaded server. The wall-clock timeout is the server's job.
    spec = os.environ.get(LIMITS_ENV)
    if not spec or os.name != "posix":
        return
    import resource
    cpu, write_mb, memory_mb = (int(x) for x in spec.split(","))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    resource.setrlimit(resource.RLIMIT_FSIZE, (write_mb << 20, write_mb << 20))
    resource.setrlimit(resource.RLIMIT_AS, (memory_mb << 20, memory_mb << 20))


def main() -> None:
    analyzers, name = sys.argv[1], sys.argv[2]
    text = sys.stdin.buffer.read().decode("utf-8")
    limit_resources()

    import NLPPlus

    NLPPlus.set_analyzers_folder(analyzers)
    NLPPlus.engine.analyze(text, name)
    sys.stdout.write("\n" + DONE + "\n")
    sys.stdout.flush()
    NLPPlus.engine.close()


if __name__ == "__main__":
    main()
